import {
    Controller,
    Get,
    Post,
    Delete,
    Param,
    Req,
    UseGuards,
} from '@nestjs/common';

import { ArtisansService } from './artisans.service.js';

// Use your existing authentication guard and authenticated request type.

@Controller('customers/artisans')
export class ArtisansController {
    constructor(
        private readonly artisansService: ArtisansService,
    ) { }

    @Post('saved/:artisanId')
    async saveArtisan(
        @Req() req: any,
        @Param('artisanId') artisanId: string,
    ) {
        const customerId = req.user.id;

        return this.artisansService.saveArtisan(
            customerId,
            artisanId,
        );
    }

    @Get('saved')
    async getSavedArtisans(@Req() req: any) {
        const customerId = req.user.id;

        return this.artisansService.getSavedArtisans(customerId);
    }

    @Delete('saved/:artisanId')
    async unsaveArtisan(
        @Req() req: any,
        @Param('artisanId') artisanId: string,
    ) {
        const customerId = req.user.id;

        return this.artisansService.unsaveArtisan(
            customerId,
            artisanId,
        );
    }

    @Get(':artisanId/saved-status')
    async isArtisanSaved(
        @Req() req: any,
        @Param('artisanId') artisanId: string,
    ) {
        const customerId = req.user.id;

        return this.artisansService.isArtisanSaved(
            customerId,
            artisanId,
        );
    }
}