-- =====================================================================
-- Deevi :: 008 :: Seed data (idempotent)
-- The catalogue is DATA. Admin can add/rename/deactivate freely; no
-- business logic anywhere in the codebase branches on these slugs.
-- =====================================================================

insert into public.service_categories (name, slug, group_key, description, sort_order)
values
  ('Plumbing',            'plumbing',            'HOME_REPAIR', 'Pipes, taps, tanks, leaks and drainage', 10),
  ('Electrical',          'electrical',          'HOME_REPAIR', 'Wiring, sockets, lighting and faults', 20),
  ('Carpentry',           'carpentry',           'HOME_REPAIR', 'Furniture, doors, wardrobes and fittings', 30),
  ('Painting',            'painting',            'HOME_REPAIR', 'Interior and exterior painting', 40),
  ('Tiling',              'tiling',              'HOME_REPAIR', 'Floor and wall tiling', 50),
  ('Air Conditioning',    'air-conditioning',    'HOME_REPAIR', 'AC installation, servicing and repair', 60),
  ('Generator Services',  'generator-services',  'HOME_REPAIR', 'Generator repair, servicing and installation', 70),
  ('Appliance Repair',    'appliance-repair',    'HOME_REPAIR', 'Fridges, washing machines, microwaves and more', 80),
  ('Cleaning',            'cleaning',            'HOME_REPAIR', 'Home, office and post-construction cleaning', 90),
  ('Welding & Metalwork', 'welding-metalwork',   'HOME_REPAIR', 'Gates, burglary proof, railings and repairs', 100),
  ('POP & Ceiling',       'pop-ceiling',         'HOME_REPAIR', 'POP design, ceiling and screeding', 110),
  ('Beauty',              'beauty',              'PERSONAL',    'Skincare, spa and beauty treatments', 200),
  ('Hair',                'hair',                'PERSONAL',    'Braiding, weaving, styling and treatments', 210),
  ('Makeup',              'makeup',              'PERSONAL',    'Bridal, event and everyday makeup', 220),
  ('Barbing',             'barbing',             'PERSONAL',    'Haircuts, shaves and grooming', 230),
  ('Nails',               'nails',               'PERSONAL',    'Manicure, pedicure and nail art', 240),
  ('Tailoring',           'tailoring',           'PERSONAL',    'Sewing, alterations and bespoke outfits', 250),
  ('Laundry',             'laundry',             'PERSONAL',    'Washing, ironing and dry cleaning', 260),
  ('Catering',            'catering',            'PERSONAL',    'Small chops, event catering and private chefs', 270),
  ('Ride',                'ride',                'MOBILITY',    'Short-distance rides', 300),
  ('Moving',              'moving',              'MOBILITY',    'House and office relocation', 310),
  ('Delivery',            'delivery',            'MOBILITY',    'Package pickup and delivery', 320),
  ('Haulage',             'haulage',             'MOBILITY',    'Heavy and bulk transport', 330)
on conflict (slug) where deleted_at is null do update
  set name = excluded.name,
      group_key = excluded.group_key,
      description = excluded.description,
      sort_order = excluded.sort_order;

insert into public.services (category_id, name, slug, description, sort_order)
select c.id, v.name, v.slug, v.description, v.sort_order
  from (values
    ('plumbing', 'Leak & Pipe Repair', 'leak-pipe-repair', 'Fix leaking pipes, taps and joints', 10),
    ('plumbing', 'Water Tank & Pump Installation', 'tank-pump-installation', 'Install or service tanks and pumps', 20),
    ('plumbing', 'Toilet & Bathroom Fittings', 'toilet-bathroom-fittings', 'WC, shower and sink installation', 30),
    ('plumbing', 'Drainage & Soakaway', 'drainage-soakaway', 'Blocked drains and soakaway work', 40),
    ('electrical', 'Wiring & Rewiring', 'wiring-rewiring', 'New wiring or full rewiring', 10),
    ('electrical', 'Socket & Switch Repair', 'socket-switch-repair', 'Faulty sockets, switches and breakers', 20),
    ('electrical', 'Lighting Installation', 'lighting-installation', 'Ceiling lights, chandeliers and security lights', 30),
    ('electrical', 'Inverter & Solar', 'inverter-solar', 'Inverter and solar installation and repair', 40),
    ('carpentry', 'Furniture Making', 'furniture-making', 'Custom furniture built to order', 10),
    ('carpentry', 'Wardrobe & Cabinet', 'wardrobe-cabinet', 'Fitted wardrobes and kitchen cabinets', 20),
    ('carpentry', 'Door & Window Repair', 'door-window-repair', 'Hanging, aligning and repairing doors', 30),
    ('painting', 'Interior Painting', 'interior-painting', 'Rooms, ceilings and walls', 10),
    ('painting', 'Exterior Painting', 'exterior-painting', 'Building exteriors and fences', 20),
    ('painting', 'Screeding & Texture', 'screeding-texture', 'Wall screeding and textured finishes', 30),
    ('tiling', 'Floor Tiling', 'floor-tiling', 'Floor tile laying and replacement', 10),
    ('tiling', 'Wall Tiling', 'wall-tiling', 'Kitchen and bathroom wall tiles', 20),
    ('air-conditioning', 'AC Installation', 'ac-installation', 'Split and window unit installation', 10),
    ('air-conditioning', 'AC Servicing', 'ac-servicing', 'Gas top-up, cleaning and servicing', 20),
    ('air-conditioning', 'AC Repair', 'ac-repair', 'Diagnose and fix AC faults', 30),
    ('generator-services', 'Generator Repair', 'generator-repair', 'Diagnose and fix generator faults', 10),
    ('generator-services', 'Generator Servicing', 'generator-servicing', 'Routine servicing and oil change', 20),
    ('appliance-repair', 'Fridge & Freezer Repair', 'fridge-freezer-repair', 'Cooling and compressor faults', 10),
    ('appliance-repair', 'Washing Machine Repair', 'washing-machine-repair', 'Washer and dryer faults', 20),
    ('appliance-repair', 'Microwave & Oven Repair', 'microwave-oven-repair', 'Kitchen appliance repair', 30),
    ('cleaning', 'Home Deep Cleaning', 'home-deep-cleaning', 'Full deep clean of a home', 10),
    ('cleaning', 'Office Cleaning', 'office-cleaning', 'Recurring or one-off office cleaning', 20),
    ('cleaning', 'Post-Construction Cleaning', 'post-construction-cleaning', 'Clean-up after building work', 30),
    ('cleaning', 'Fumigation', 'fumigation', 'Pest control and fumigation', 40),
    ('welding-metalwork', 'Gate & Burglary Proof', 'gate-burglary-proof', 'Fabrication and installation', 10),
    ('welding-metalwork', 'Metal Repair', 'metal-repair', 'On-site welding and repairs', 20),
    ('pop-ceiling', 'POP Ceiling Design', 'pop-ceiling-design', 'POP design and installation', 10),
    ('pop-ceiling', 'Ceiling Repair', 'ceiling-repair', 'Repair damaged or sagging ceilings', 20)
  ) as v(category_slug, name, slug, description, sort_order)
  join public.service_categories c on c.slug = v.category_slug and c.deleted_at is null
on conflict (slug) where deleted_at is null do update
  set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

insert into public.services (category_id, name, slug, description, sort_order)
select c.id, v.name, v.slug, v.description, v.sort_order
  from (values
    ('beauty', 'Facial & Skincare', 'facial-skincare', 'Facials and skin treatments', 10),
    ('beauty', 'Massage & Spa', 'massage-spa', 'Home spa and massage sessions', 20),
    ('beauty', 'Lashes & Brows', 'lashes-brows', 'Lash extensions and brow shaping', 30),
    ('hair', 'Braiding', 'braiding', 'All braid styles', 10),
    ('hair', 'Weaving & Wig Installation', 'weaving-wig-installation', 'Weaves, wigs and frontals', 20),
    ('hair', 'Hair Treatment', 'hair-treatment', 'Relaxing, steaming and treatments', 30),
    ('hair', 'Locs & Twists', 'locs-twists', 'Loc maintenance, retwist and styling', 40),
    ('makeup', 'Bridal Makeup', 'bridal-makeup', 'Bridal and bridal party makeup', 10),
    ('makeup', 'Event Makeup', 'event-makeup', 'Parties, shoots and occasions', 20),
    ('makeup', 'Gele Tying', 'gele-tying', 'Gele and headwrap styling', 30),
    ('barbing', 'Haircut', 'haircut', 'Home or shop haircut', 10),
    ('barbing', 'Beard Grooming', 'beard-grooming', 'Beard shaping, trim and dye', 20),
    ('barbing', 'Kids Haircut', 'kids-haircut', 'Haircuts for children', 30),
    ('nails', 'Manicure', 'manicure', 'Nail care and polish', 10),
    ('nails', 'Pedicure', 'pedicure', 'Foot care and polish', 20),
    ('nails', 'Nail Extensions', 'nail-extensions', 'Acrylic, gel and nail art', 30),
    ('tailoring', 'Custom Outfit', 'custom-outfit', 'Bespoke sewing from measurements', 10),
    ('tailoring', 'Alterations & Repairs', 'alterations-repairs', 'Resize, mend and adjust', 20),
    ('tailoring', 'Native Wear', 'native-wear', 'Agbada, kaftan and traditional wear', 30),
    ('laundry', 'Wash & Iron', 'wash-and-iron', 'Pickup, wash, iron and return', 10),
    ('laundry', 'Dry Cleaning', 'dry-cleaning', 'Professional dry cleaning', 20),
    ('laundry', 'Ironing Only', 'ironing-only', 'Ironing service only', 30),
    ('catering', 'Small Chops', 'small-chops', 'Small chops and finger food', 10),
    ('catering', 'Event Catering', 'event-catering', 'Full catering for events', 20),
    ('catering', 'Private Chef', 'private-chef', 'In-home cooking service', 30),
    ('ride', 'Short-Distance Ride', 'short-distance-ride', 'Point-to-point rides within a city', 10),
    ('ride', 'Airport Pickup', 'airport-pickup', 'Airport drop-off and pickup', 20),
    ('moving', 'House Moving', 'house-moving', 'Full home relocation', 10),
    ('moving', 'Office Moving', 'office-moving', 'Office and equipment relocation', 20),
    ('moving', 'Single Item Move', 'single-item-move', 'Move one large item', 30),
    ('delivery', 'Same-Day Delivery', 'same-day-delivery', 'Same-day package delivery', 10),
    ('delivery', 'Errand Running', 'errand-running', 'Pickups, drop-offs and errands', 20),
    ('haulage', 'Truck Haulage', 'truck-haulage', 'Bulk and heavy goods transport', 10),
    ('haulage', 'Building Materials Transport', 'building-materials-transport', 'Sand, blocks and cement transport', 20)
  ) as v(category_slug, name, slug, description, sort_order)
  join public.service_categories c on c.slug = v.category_slug and c.deleted_at is null
on conflict (slug) where deleted_at is null do update
  set name = excluded.name, description = excluded.description, sort_order = excluded.sort_order;

-- A couple of sub-services to prove the third level works end to end.
insert into public.sub_services (service_id, name, slug, sort_order)
select s.id, v.name, v.slug, v.sort_order
  from (values
    ('braiding', 'Knotless Braids', 'knotless-braids', 10),
    ('braiding', 'Ghana Weaving', 'ghana-weaving', 20),
    ('braiding', 'Cornrows', 'cornrows', 30),
    ('ac-servicing', 'Split Unit Servicing', 'split-unit-servicing', 10),
    ('ac-servicing', 'Gas Top-Up', 'gas-top-up', 20),
    ('leak-pipe-repair', 'Kitchen Sink Leak', 'kitchen-sink-leak', 10),
    ('leak-pipe-repair', 'Overhead Tank Leak', 'overhead-tank-leak', 20),
    ('wiring-rewiring', 'Full House Rewiring', 'full-house-rewiring', 10),
    ('wiring-rewiring', 'Single Room Wiring', 'single-room-wiring', 20)
  ) as v(service_slug, name, slug, sort_order)
  join public.services s on s.slug = v.service_slug and s.deleted_at is null
on conflict (service_id, slug) where deleted_at is null do update
  set name = excluded.name, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------
-- Premium artisan subscription plans. Amounts are placeholders pending a
-- commercial decision; the provider is MOCK until a real PSP is wired up.
-- ---------------------------------------------------------------------
insert into public.subscription_plans
  (code, name, description, amount, currency, billing_interval, trial_days,
   monthly_application_limit, features, sort_order, provider)
values
  ('FREE', 'Free', 'Everything an artisan needs to win their first jobs.',
   0, 'NGN', 'MONTHLY', 0, 15,
   '{"applications_per_month": 15, "priority_support": false, "featured_profile": false, "boost_credits": 0}'::jsonb,
   10, 'MOCK'),
  ('PREMIUM_MONTHLY', 'Premium Monthly', 'Unlimited applications, featured profile and boost credits.',
   3500, 'NGN', 'MONTHLY', 7, null,
   '{"applications_per_month": null, "priority_support": true, "featured_profile": true, "boost_credits": 10}'::jsonb,
   20, 'MOCK'),
  ('PREMIUM_YEARLY', 'Premium Yearly', 'Two months free versus paying monthly.',
   35000, 'NGN', 'YEARLY', 7, null,
   '{"applications_per_month": null, "priority_support": true, "featured_profile": true, "boost_credits": 150}'::jsonb,
   30, 'MOCK')
on conflict (code) do update
  set name = excluded.name,
      description = excluded.description,
      amount = excluded.amount,
      billing_interval = excluded.billing_interval,
      monthly_application_limit = excluded.monthly_application_limit,
      features = excluded.features,
      sort_order = excluded.sort_order;
