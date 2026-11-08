import { ConfigService } from '@nestjs/config';
import { UploadedMediaFile } from './src/jobs/jobs.controller.js';
export declare class CloudinaryService {
    private readonly config;
    constructor(config: ConfigService);
    uploadImage(file: UploadedMediaFile, folder: string): Promise<import("cloudinary").UploadApiResponse>;
    deleteImage(publicId: string): Promise<any>;
}
