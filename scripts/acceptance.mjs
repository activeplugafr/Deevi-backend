#!/usr/bin/env node
/**
 * Deevi MVP acceptance test.
 *
 * Drives the entire marketplace loop over real HTTP against a running API and
 * the live Supabase project: customer signup, job posting with a chosen
 * location, admin approval of an artisan, the artisan's feed, bidding,
 * messaging, selection, the job lifecycle, and the review.
 *
 * Also asserts the negative cases that matter: unapproved artisans cannot see
 * the feed, non-participants cannot read conversations, and the street address
 * is withheld until an artisan is actually selected.
 *
 *   npm run acceptance
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

const BASE = process.env.ACCEPTANCE_BASE_URL ?? 'http://localhost:3001/api/v1';
const stamp = Date.now();
// Supabase's address validator rejects reserved TLDs such as .test, so the
// throwaway accounts use a real-looking domain. Override with ACCEPTANCE_EMAIL_DOMAIN.
// Supabase's address validator rejects reserved and example TLDs, so throwaway
// accounts use a real domain. Override with ACCEPTANCE_EMAIL_DOMAIN.
const DOMAIN = process.env.ACCEPTANCE_EMAIL_DOMAIN ?? 'deevi.ng';

// Confirm addresses out-of-band with the service key, so the test does not
// depend on whether the project requires email confirmation.
const admin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/**
 * Provisions a test account without triggering a confirmation email.
 *
 * Supabase's free tier throttles transactional email to a couple per hour, so
 * repeatedly exercising POST /auth/signup would fail on the mail send rather
 * than on anything Deevi does. Creating the auth account directly and then
 * logging in drives the API's own self-heal path, which provisions the Deevi
 * user, role and profile for an auth account that has none.
 */
const provision = async (email, role, firstName, lastName) => {
  const { error } = await admin.auth.admin.createUser({
    email, password: pw, email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, role },
  });
  if (error) {
    console.error(`
  Could not provision ${email}: ${error.message}
`);
    process.exit(1);
  }
};
const pw = 'Deevi12345';

let passed = 0;
const failures = [];

const check = (label, condition, detail) => {
  if (condition) {
    passed += 1;
    console.log(`  ok    ${label}`);
  } else {
    failures.push(`${label}${detail ? ` -- ${detail}` : ''}`);
    console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ''}`);
  }
};

const api = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, body: json };
};

const die = (stage, response) => {
  console.error(`\n  Stopped at: ${stage}`);
  console.error(`  ${response.status} ${JSON.stringify(response.body).slice(0, 500)}\n`);
  process.exit(1);
};

console.log(`\n  Deevi MVP acceptance test against ${BASE}\n`);

/* ------------------------------------------------------------------ */
/* 0. Health and catalogue                                             */
/* ------------------------------------------------------------------ */
const healthDirect = await fetch(`${BASE.replace('/api/v1', '')}/health`).then((r) => r.json());
check('API is up', healthDirect.status === 'ok');
check('boosts and subscriptions are dormant',
  healthDirect.dormantFeatures?.includes('boosts') && healthDirect.dormantFeatures?.includes('subscriptions'),
  JSON.stringify(healthDirect.dormantFeatures));

const catalogue = await api('GET', '/catalogue/tree');
if (catalogue.status !== 200) die('catalogue', catalogue);
check('catalogue is admin/database driven', catalogue.body.length >= 20,
  `${catalogue.body.length} categories`);

const groups = new Set(catalogue.body.map((c) => c.group_key));
check('home/repair, personal and mobility services all present',
  ['HOME_REPAIR', 'PERSONAL', 'MOBILITY'].every((g) => groups.has(g)), [...groups].join(','));

const plumbing = catalogue.body.find((c) => c.slug === 'plumbing');
const service = plumbing?.services?.[0];
if (!service) die('catalogue: no plumbing service', catalogue);

/* ------------------------------------------------------------------ */
/* 1. CUSTOMER signup                                                  */
/* ------------------------------------------------------------------ */
const customerEmail = `deevi.cust.${stamp}@${DOMAIN}`;
// The signup DTO must reject a malformed payload before any provider is called.
const badSignup = await api('POST', '/auth/signup', {
  body: { email: 'not-an-email', password: 'short', role: 'WIZARD' },
});
check('signup validates its payload',
  badSignup.status === 400 && badSignup.body.code === 'VALIDATION_FAILED', badSignup.body.code);

await provision(customerEmail, 'CUSTOMER', 'Ada', 'Obi');

const customerLogin = await api('POST', '/auth/login', { body: { email: customerEmail, password: pw } });
if (customerLogin.status !== 200) die('customer login', customerLogin);
const customerToken = customerLogin.body.session.accessToken;
check('customer can log in', Boolean(customerToken));
check('the customer is provisioned with the CUSTOMER role and profile',
  customerLogin.body.user.roles.includes('CUSTOMER') && Boolean(customerLogin.body.user.customerProfileId));

const wrongPassword = await api('POST', '/auth/login', {
  body: { email: customerEmail, password: 'WrongPassword1' },
});
check('a wrong password is rejected without revealing the account exists',
  wrongPassword.status === 401 && wrongPassword.body.message === 'Invalid email or password');

const me = await api('GET', '/auth/me', { token: customerToken });
check('protected route works with a token', me.status === 200 && me.body.email === customerEmail);

const anon = await api('GET', '/auth/me');
check('protected route rejects anonymous access', anon.status === 401 && anon.body.code === 'UNAUTHENTICATED');

/* ------------------------------------------------------------------ */
/* 2. ARTISAN signup and onboarding                                    */
/* ------------------------------------------------------------------ */
const artisanEmail = `deevi.art.${stamp}@${DOMAIN}`;
await provision(artisanEmail, 'ARTISAN', 'Chidi', 'Eze');

const artisanLogin = await api('POST', '/auth/login', { body: { email: artisanEmail, password: pw } });
if (artisanLogin.status !== 200) die('artisan login', artisanLogin);
const artisanToken = artisanLogin.body.session.accessToken;
const artisanProfileId = artisanLogin.body.user.artisanProfileId;
check('artisan starts unverified',
  artisanLogin.body.user.artisanVerificationStatus === 'PENDING',
  artisanLogin.body.user.artisanVerificationStatus);

const blockedFeed = await api('GET', '/feed/jobs', { token: artisanToken });
check('unapproved artisan cannot see the job feed',
  blockedFeed.status === 403 && blockedFeed.body.code === 'ARTISAN_NOT_APPROVED',
  `${blockedFeed.status} ${blockedFeed.body.code}`);

await api('PATCH', '/artisans/me', {
  token: artisanToken,
  body: {
    headline: 'Certified plumber, 8 years in Lagos',
    bio: 'Leaks, tank installation and full bathroom fittings.',
    yearsOfExperience: 8, baseCity: 'Surulere', baseState: 'Lagos',
    baseLatitude: 6.4969, baseLongitude: 3.3481, maxTravelKm: 25,
  },
});

const setServices = await api('PUT', '/artisans/me/services', {
  token: artisanToken,
  body: { services: [{ serviceId: service.id, priceMin: 10000, priceMax: 60000, yearsExperience: 8 }] },
});
check('artisan can select services', setServices.status === 200);

const setAreas = await api('PUT', '/artisans/me/service-areas', {
  token: artisanToken,
  body: { areas: [{ city: 'Lagos Island', state: 'Lagos', latitude: 6.4541, longitude: 3.3947, radiusKm: 30 }] },
});
check('artisan can set service areas', setAreas.status === 200);

await api('PUT', '/artisans/me/availability', {
  token: artisanToken,
  body: { slots: [{ dayOfWeek: 1, startTime: '08:00', endTime: '18:00' }] },
});

/* ------------------------------------------------------------------ */
/* 3. Verification: incomplete profile is refused, then documents      */
/* ------------------------------------------------------------------ */
const premature = await api('POST', '/artisans/me/application', { token: artisanToken, body: {} });
check('verification refuses an incomplete profile and says what is missing',
  premature.status === 422 && Array.isArray(premature.body.details),
  `${premature.status} ${JSON.stringify(premature.body.details ?? premature.body.code)}`);

const ticket = await api('POST', '/storage/upload-ticket', {
  token: artisanToken,
  body: { bucket: 'verification-documents', filename: 'nin.jpg', mimeType: 'image/jpeg', sizeBytes: 4096 },
});
if (ticket.status >= 400) die('upload ticket', ticket);
check('private bucket ticket exposes no public URL', ticket.body.publicUrl === null);

const badTicket = await api('POST', '/storage/upload-ticket', {
  token: artisanToken,
  body: { bucket: 'avatars', filename: 'x.exe', mimeType: 'application/x-msdownload' },
});
check('upload validation rejects a disallowed file type', badTicket.status === 415, String(badTicket.status));

const addDoc = await api('POST', '/artisans/me/verification-documents', {
  token: artisanToken,
  body: { documentType: 'NIN', storagePath: ticket.body.path, originalFilename: 'nin.jpg', mimeType: 'image/jpeg' },
});
check('artisan can attach a verification document', addDoc.status === 201 || addDoc.status === 200,
  String(addDoc.status));

const submitted = await api('POST', '/artisans/me/application', {
  token: artisanToken, body: { note: 'Available weekdays.' },
});
if (submitted.status >= 400) die('submit application', submitted);
check('artisan can submit for verification', submitted.body.status === 'PENDING');

/* ------------------------------------------------------------------ */
/* 4. ADMIN approves the artisan                                       */
/* ------------------------------------------------------------------ */
const adminEmail = process.env.ACCEPTANCE_ADMIN_EMAIL;
const adminPassword = process.env.ACCEPTANCE_ADMIN_PASSWORD;
if (!adminEmail || !adminPassword) {
  console.error('\n  ACCEPTANCE_ADMIN_EMAIL / ACCEPTANCE_ADMIN_PASSWORD must be set.');
  console.error('  Create one with: npm run admin:create -- ops@deevi.ng <password>\n');
  process.exit(1);
}

const adminLogin = await api('POST', '/auth/login', { body: { email: adminEmail, password: adminPassword } });
if (adminLogin.status !== 200) die('admin login', adminLogin);
const adminToken = adminLogin.body.session.accessToken;
check('admin can log in', adminLogin.body.user.adminRole === 'SUPER_ADMIN', adminLogin.body.user.adminRole);

const forbidden = await api('GET', '/admin/metrics', { token: customerToken });
check('a customer cannot reach the admin dashboard', forbidden.status === 403, String(forbidden.status));

const metrics = await api('GET', '/admin/metrics', { token: adminToken });
check('admin dashboard returns metrics', metrics.status === 200 && metrics.body.users?.total > 0);

const queue = await api('GET', '/admin/artisan-applications', { token: adminToken });
if (queue.status !== 200) die('verification queue', queue);
const mine = queue.body.items.find((a) => a.artisan_id === artisanProfileId);
check('the submitted application reaches the verification queue', Boolean(mine));

const rejectNoReason = await api('POST', `/admin/artisan-applications/${mine.id}/review`, {
  token: adminToken, body: { decision: 'REJECTED' },
});
check('rejection without a reason is refused',
  rejectNoReason.status === 400 && rejectNoReason.body.code === 'REJECTION_REASON_REQUIRED',
  rejectNoReason.body.code);

const approve = await api('POST', `/admin/artisan-applications/${mine.id}/review`, {
  token: adminToken, body: { decision: 'APPROVED', notes: 'ID verified.' },
});
if (approve.status >= 400) die('approve artisan', approve);
check('admin approves the artisan', approve.body.application.status === 'APPROVED');

const reApprove = await api('POST', `/admin/artisan-applications/${mine.id}/review`, {
  token: adminToken, body: { decision: 'APPROVED' },
});
check('an already-decided application cannot be re-decided',
  reApprove.status === 409, String(reApprove.status));

/* ------------------------------------------------------------------ */
/* 5. CUSTOMER posts a job at a location that is NOT their address     */
/* ------------------------------------------------------------------ */
const savedLocation = await api('POST', '/customers/me/locations', {
  token: customerToken,
  body: {
    label: 'Home', addressLine: '12 Igando Road', city: 'Igando', state: 'Lagos',
    latitude: 6.5486, longitude: 3.2419, isDefault: true,
  },
});
check('customer can save a home location', savedLocation.status === 201 || savedLocation.status === 200);

// The job is in Obalende even though the customer lives in Igando.
const createJob = await api('POST', '/jobs', {
  token: customerToken,
  body: {
    title: 'Kitchen sink has been leaking for two days',
    description:
      'The pipe under my kitchen sink drips constantly and the cabinet floor is now soaked. ' +
      'I need someone who can come this week and replace the joint.',
    serviceId: service.id,
    urgency: 'HIGH',
    budgetMin: 15000,
    budgetMax: 40000,
    preferredTimeNotes: 'Weekday mornings, or Saturday any time',
    location: {
      addressLine: '14 Adeola Odeku Street, flat 3',
      neighbourhood: 'Obalende', city: 'Lagos Island', state: 'Lagos',
      latitude: 6.4541, longitude: 3.3947,
      locationNotes: 'Blue gate, ring twice', source: 'MAP',
    },
  },
});
if (createJob.status >= 400) die('create job', createJob);
const jobPostId = createJob.body.id;
check('customer can post a job', createJob.body.status === 'PUBLISHED');
check('the job location is independent of the customer profile address',
  createJob.body.city === 'Lagos Island' && createJob.body.address_line.includes('Adeola Odeku'));

const noLocation = await api('POST', '/jobs', {
  token: customerToken,
  body: {
    title: 'Job with no resolvable location',
    description: 'This job deliberately omits any city or coordinates whatsoever.',
    serviceId: service.id, location: { locationNotes: 'behind the big tree' },
  },
});
check('a job without a resolvable location is refused',
  noLocation.status === 400 && noLocation.body.code === 'LOCATION_REQUIRED', noLocation.body.code);

/* ------------------------------------------------------------------ */
/* 6. ARTISAN sees the job in their feed                               */
/* ------------------------------------------------------------------ */
const relogin = await api('POST', '/auth/login', { body: { email: artisanEmail, password: pw } });
const approvedToken = relogin.body.session.accessToken;
check('approval is reflected on the artisan principal',
  relogin.body.user.artisanVerificationStatus === 'APPROVED');

const feed = await api('GET', '/feed/jobs?limit=50', { token: approvedToken });
if (feed.status !== 200) die('artisan feed', feed);
const feedJob = feed.body.items.find((j) => j.id === jobPostId);
check('the job appears in the relevant artisan feed', Boolean(feedJob),
  `${feed.body.items.length} jobs returned`);
check('the feed is paginated', typeof feed.body.meta?.total === 'number');
check('the feed carries a deterministic relevance score',
  typeof feedJob?.relevance_score === 'number' && feedJob.relevance_score > 0,
  String(feedJob?.relevance_score));
check('the artisan sees the real customer description',
  feedJob?.description?.startsWith('The pipe under my kitchen sink'));
check('the feed withholds the street address',
  feedJob && !('address_line' in feedJob) && !('location_notes' in feedJob));
check('the feed coarsens coordinates', feedJob?.latitude_approx === 6.45);
check('the feed reports distance from the artisan service area',
  typeof feedJob?.distance_km === 'number', String(feedJob?.distance_km));
check('the job appears exactly once in the feed',
  feed.body.items.filter((j) => j.id === jobPostId).length === 1);

const jobDetail = await api('GET', `/jobs/${jobPostId}`, { token: approvedToken });
check('a browsing artisan gets the marketplace view',
  jobDetail.body.viewerRole === 'MARKETPLACE', jobDetail.body.viewerRole);
check('the street address is withheld before selection',
  jobDetail.body.address_line === undefined);

/* ------------------------------------------------------------------ */
/* 7. ARTISAN applies, CUSTOMER reviews the application                */
/* ------------------------------------------------------------------ */
const apply = await api('POST', '/applications', {
  token: approvedToken,
  body: {
    jobPostId,
    message: 'I replaced the same joint on a similar sink last week. I can come Thursday morning.',
    proposedPrice: 25000, priceType: 'FIXED',
    estimatedDurationValue: 3, estimatedDurationUnit: 'HOUR',
    availabilityNote: 'Weekday mornings', relevantExperience: '8 years on residential plumbing',
  },
});
if (apply.status >= 400) die('artisan applies', apply);
const applicationId = apply.body.id;
check('artisan can apply with a price and timeline', apply.body.status === 'SUBMITTED');

const duplicate = await api('POST', '/applications', {
  token: approvedToken, body: { jobPostId, message: 'Trying to apply to this same job a second time.' },
});
check('an artisan cannot apply twice to the same job',
  duplicate.status === 409 && duplicate.body.code === 'ALREADY_APPLIED', duplicate.body.code);

const ownJob = await api('POST', '/applications', {
  token: customerToken, body: { jobPostId, message: 'The customer trying to bid on their own job post.' },
});
check('a customer cannot bid on their own job', ownJob.status === 403 || ownJob.status === 400);

const applications = await api('GET', `/jobs/${jobPostId}/applications`, { token: customerToken });
if (applications.status !== 200) die('list applications', applications);
check('customer sees the application', applications.body.items.length === 1);
check('the application carries an artisan preview for comparison',
  Boolean(applications.body.items[0].artisan_profiles?.rating_average !== undefined));

const notMine = await api('GET', `/jobs/${jobPostId}/applications`, { token: approvedToken });
check('an artisan cannot read the applications on someone else job',
  notMine.status === 403, String(notMine.status));

const shortlist = await api('POST', `/applications/${applicationId}/shortlist`, { token: customerToken });
check('customer can shortlist an application', shortlist.status === 201 || shortlist.status === 200);

/* ------------------------------------------------------------------ */
/* 8. Messaging                                                        */
/* ------------------------------------------------------------------ */
const conversation = await api('POST', '/conversations', {
  token: customerToken,
  body: { jobPostId, artisanId: artisanProfileId, message: 'Can you come Saturday morning instead?' },
});
if (conversation.status >= 400) die('start conversation', conversation);
const conversationId = conversation.body.id;
check('customer can message the artisan about the job', Boolean(conversationId));

const reply = await api('POST', `/conversations/${conversationId}/messages`, {
  token: approvedToken, body: { body: 'Saturday morning works. I will arrive around 9am.' },
});
check('artisan can reply', reply.status === 201 || reply.status === 200);

const thread = await api('GET', `/conversations/${conversationId}/messages`, { token: customerToken });
check('the thread reads back in order',
  thread.body.items?.length === 2 && thread.body.items[0].body.startsWith('Can you come'),
  `${thread.body.items?.length} messages`);

// A third party must not be able to read a private negotiation.
const outsiderEmail = `deevi.out.${stamp}@${DOMAIN}`;
await provision(outsiderEmail, 'CUSTOMER', 'Nosy', 'Person');
const outsider = await api('POST', '/auth/login', { body: { email: outsiderEmail, password: pw } });
const outsiderToken = outsider.body.session?.accessToken;
const peek = await api('GET', `/conversations/${conversationId}/messages`, { token: outsiderToken });
check('a non-participant cannot read the conversation',
  peek.status === 403 && peek.body.code === 'NOT_CONVERSATION_PARTICIPANT', peek.body.code);

/* ------------------------------------------------------------------ */
/* 9. Selection -- including the concurrency guarantee                 */
/* ------------------------------------------------------------------ */
const select = await api('POST', `/applications/${applicationId}/select`, {
  token: customerToken, body: { agreedPrice: 25000 },
});
if (select.status >= 400) die('select artisan', select);
const jobId = select.body.job.id;
check('customer selects the artisan', select.body.job.status === 'PENDING_ACCEPTANCE');

// Two simultaneous selections must not both succeed.
const racers = await Promise.all([
  api('POST', `/applications/${applicationId}/select`, { token: customerToken, body: {} }),
  api('POST', `/applications/${applicationId}/select`, { token: customerToken, body: {} }),
]);
check('a second selection is refused, never double-accepted',
  racers.every((r) => r.status >= 400),
  racers.map((r) => `${r.status}:${r.body.code}`).join(' '));

const engagedView = await api('GET', `/jobs/${jobPostId}`, { token: approvedToken });
check('the selected artisan is now given the street address',
  engagedView.body.address_line?.includes('Adeola Odeku'), engagedView.body.viewerRole);

/* ------------------------------------------------------------------ */
/* 10. Job lifecycle                                                   */
/* ------------------------------------------------------------------ */
const earlyComplete = await api('POST', `/engagements/${jobId}/complete`, { token: customerToken });
check('a job cannot be completed before it starts',
  earlyComplete.status === 409, `${earlyComplete.status} ${earlyComplete.body.code}`);

const accept = await api('POST', `/engagements/${jobId}/accept`, { token: approvedToken });
if (accept.status >= 400) die('artisan accepts', accept);
check('artisan accepts the job', accept.body.status === 'ACCEPTED');

const start = await api('POST', `/engagements/${jobId}/start`, { token: approvedToken });
check('artisan starts the work', start.body.status === 'IN_PROGRESS', String(start.status));

const artisanDone = await api('POST', `/engagements/${jobId}/artisan-complete`, { token: approvedToken });
check('artisan flags the work finished, awaiting confirmation',
  artisanDone.body.awaitingCustomerConfirmation === true);

const artisanCompletes = await api('POST', `/engagements/${jobId}/complete`, { token: approvedToken });
check('the artisan cannot confirm completion themselves',
  artisanCompletes.status === 403, String(artisanCompletes.status));

const complete = await api('POST', `/engagements/${jobId}/complete`, { token: customerToken });
if (complete.status >= 400) die('complete job', complete);
check('customer confirms completion', complete.body.status === 'COMPLETED');

/* ------------------------------------------------------------------ */
/* 11. Review                                                          */
/* ------------------------------------------------------------------ */
const eligibility = await api('GET', `/reviews/eligibility/${jobId}`, { token: customerToken });
check('customer is eligible to review the completed job', eligibility.body.canReview === true,
  eligibility.body.reason);

const review = await api('POST', '/reviews', {
  token: customerToken,
  body: { jobId, rating: 5, comment: 'Arrived on time, fixed the leak properly and cleaned up after.' },
});
if (review.status >= 400) die('leave review', review);
check('customer reviews the artisan', review.body.rating === 5);

const duplicateReview = await api('POST', '/reviews', {
  token: customerToken, body: { jobId, rating: 3, comment: 'Trying to review this same job twice over.' },
});
check('a duplicate review is refused',
  duplicateReview.status === 409 && duplicateReview.body.code === 'ALREADY_REVIEWED',
  duplicateReview.body.code);

const strangerReview = await api('POST', '/reviews', {
  token: outsiderToken, body: { jobId, rating: 1, comment: 'A stranger trying to review a job they never had.' },
});
check('someone who was not on the job cannot review it',
  strangerReview.status === 403, String(strangerReview.status));

const publicProfile = await api('GET', `/artisans/${artisanProfileId}`);
check('the review updates the public artisan rating',
  Number(publicProfile.body.rating_average) === 5 && publicProfile.body.rating_count === 1,
  `${publicProfile.body.rating_average} / ${publicProfile.body.rating_count}`);

/* ------------------------------------------------------------------ */
/* 12. Reports and admin moderation                                    */
/* ------------------------------------------------------------------ */
const report = await api('POST', '/reports', {
  token: customerToken,
  body: {
    category: 'PRICING_ISSUE', jobId,
    description: 'We agreed 25000 but I was asked for more on the day of the work.',
  },
});
if (report.status >= 400) die('file report', report);
check('customer can report a problem', Boolean(report.body.reference));

const strangerReport = await api('POST', '/reports', {
  token: outsiderToken,
  body: { category: 'NO_SHOW', jobId, description: 'Reporting a job I had absolutely nothing to do with.' },
});
check('someone uninvolved cannot report the job',
  strangerReport.status === 403, String(strangerReport.status));

const reportQueue = await api('GET', '/admin/reports', { token: adminToken });
check('the report reaches the admin queue',
  reportQueue.body.items?.some((r) => r.id === report.body.id));

const resolve = await api('PATCH', `/admin/reports/${report.body.id}`, {
  token: adminToken,
  body: { status: 'RESOLVED', resolution: 'Spoke to both parties; agreed price honoured.' },
});
check('admin resolves the report', resolve.body.status === 'RESOLVED', String(resolve.status));

const adminJobs = await api('GET', '/admin/jobs', { token: adminToken });
check('admin can monitor jobs', adminJobs.status === 200 && adminJobs.body.items.length > 0);

const audit = await api('GET', '/admin/audit-logs', { token: adminToken });
check('sensitive admin actions are audited',
  audit.body.items?.some((a) => a.action === 'ARTISAN_APPLICATION_APPROVED'));

/* ------------------------------------------------------------------ */
/* 13. Notifications and matching                                      */
/* ------------------------------------------------------------------ */
const notifications = await api('GET', '/notifications', { token: approvedToken });
const types = (notifications.body.items ?? []).map((n) => n.type);
check('the artisan was notified they were selected', types.includes('ARTISAN_SELECTED'), types.join(','));
check('the artisan was notified of approval', types.includes('ARTISAN_APPROVED'));

const customerNotifications = await api('GET', '/notifications', { token: customerToken });
const customerTypes = (customerNotifications.body.items ?? []).map((n) => n.type);
check('the customer was notified of the application', customerTypes.includes('APPLICATION_RECEIVED'),
  customerTypes.join(','));

const recommended = await api('GET',
  `/matching/artisans?serviceId=${service.id}&city=Lagos%20Island&limit=10`, { token: customerToken });
check('Deevi can recommend artisans for a service and location',
  recommended.status === 200 && recommended.body.items.some((a) => a.artisan_id === artisanProfileId),
  `${recommended.body.items?.length} recommended`);

/* ------------------------------------------------------------------ */
/* 14. Dormant features are genuinely unreachable                      */
/* ------------------------------------------------------------------ */
for (const [label, path] of [
  ['subscription plans', '/subscriptions/plans'],
  ['subscription checkout', '/subscriptions/checkout'],
  ['boost balance', '/boosts/balance'],
]) {
  const res = await api('GET', path, { token: approvedToken });
  check(`${label} is not reachable`, res.status === 404, String(res.status));
}

/* ------------------------------------------------------------------ */
console.log(`\n  ${passed} checks passed, ${failures.length} failed.\n`);
if (failures.length) {
  console.log('  Failures:');
  for (const f of failures) console.log(`    - ${f}`);
  console.log('');
  process.exit(1);
}
console.log('  Deevi MVP acceptance test PASSED end to end.\n');
