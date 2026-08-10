"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.uploadFile = void 0;
const fs_1 = __importDefault(require("fs"));
const client_s3_1 = require("@aws-sdk/client-s3");
function uploadFile(settings, pathToFile, newFileName) {
    return __awaiter(this, void 0, void 0, function* () {
        // Validate inputs
        if (!settings || !settings.s3Config || !settings.s3Bucket) {
            throw new Error('Photonify: S3 configuration is missing');
        }
        if (!pathToFile || !newFileName) {
            throw new Error('Photonify: File path or filename is missing');
        }
        try {
            // Read file content
            const file = fs_1.default.readFileSync(pathToFile);
            // Create S3 client
            const client = new client_s3_1.S3Client(settings.s3Config);
            // Create upload command
            const command = new client_s3_1.PutObjectCommand({
                Bucket: settings.s3Bucket,
                Key: newFileName,
                Body: file,
            });
            // Upload file to S3
            yield client.send(command);
            // Delete temp file after upload completes
            fs_1.default.unlinkSync(pathToFile);
            console.log(`Photonify S3 Upload: ${newFileName}`);
        }
        catch (err) {
            console.error('Photonify: S3 upload error');
            console.error(err);
            throw err; // Re-throw the error so calling code can handle it
        }
    });
}
exports.uploadFile = uploadFile;
