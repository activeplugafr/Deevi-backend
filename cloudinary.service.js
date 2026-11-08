var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary } from 'cloudinary';
let CloudinaryService = class CloudinaryService {
    config;
    constructor(config) {
        this.config = config;
        cloudinary.config({
            cloud_name: this.config.getOrThrow('CLOUDINARY_CLOUD_NAME'),
            api_key: this.config.getOrThrow('CLOUDINARY_API_KEY'),
            api_secret: this.config.getOrThrow('CLOUDINARY_API_SECRET'),
        });
    }
    async uploadImage(file, folder) {
        const dataUri = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;
        return cloudinary.uploader.upload(dataUri, {
            folder,
            resource_type: 'image',
        });
    }
    async deleteImage(publicId) {
        return cloudinary.uploader.destroy(publicId, {
            resource_type: 'image',
        });
    }
};
CloudinaryService = __decorate([
    Injectable(),
    __metadata("design:paramtypes", [ConfigService])
], CloudinaryService);
export { CloudinaryService };
//# sourceMappingURL=cloudinary.service.js.map