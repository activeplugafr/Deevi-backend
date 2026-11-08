import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
import { UploadedMediaFile } from './jobs/jobs.controller.js';

@Injectable()
export class CloudinaryService {
    constructor(private readonly config: ConfigService) {
        cloudinary.config({
            cloud_name: this.config.getOrThrow<string>('CLOUDINARY_CLOUD_NAME'),
            api_key: this.config.getOrThrow<string>('CLOUDINARY_API_KEY'),
            api_secret: this.config.getOrThrow<string>('CLOUDINARY_API_SECRET'),
        });
    }

    async uploadImage(file: UploadedMediaFile, folder: string) {
        const dataUri =
            `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

        return cloudinary.uploader.upload(dataUri, {
            folder,
            resource_type: 'image',
        });
    }

    async deleteImage(publicId: string) {
        return cloudinary.uploader.destroy(publicId, {
            resource_type: 'image',
        });
    }
}