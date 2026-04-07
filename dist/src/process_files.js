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
exports.processFiles = void 0;
const path_1 = __importDefault(require("path"));
const sharp_1 = __importDefault(require("sharp"));
const uuid_1 = require("uuid");
const constants_1 = require("@app/constants");
const upload_file_1 = require("@app/upload_file");
function processFiles(files, settings) {
    return __awaiter(this, void 0, void 0, function* () {
        // Fail early if S3 is selected but not configured
        if (settings.storage === "s3" && (!settings.s3Config || !settings.s3Bucket)) {
            throw new Error("Photonify: S3 storage is selected but s3Config or s3Bucket is not set.");
        }
        const sizes = settings.sizes || constants_1.DEFAULT_SIZES;
        const outputFormat = settings.outputFormat || "jpg";
        const outputDest = settings.storage === "s3"
            ? path_1.default.join(__dirname, "../tmp_for_upload")
            : settings.outputDest || "";
        const ops = [];
        const createdFiles = [];
        files.forEach((file) => {
            Object.keys(sizes).forEach((alias) => {
                var _a, _b;
                const newFileName = `${(0, uuid_1.v4)().replace(/-/g, "")}-${alias}.${outputFormat}`;
                createdFiles.push(newFileName);
                ops.push((0, sharp_1.default)(file)
                    .resize({
                    width: (_a = sizes[alias]) === null || _a === void 0 ? void 0 : _a.width,
                    height: (_b = sizes[alias]) === null || _b === void 0 ? void 0 : _b.height,
                })
                    .toFile(path_1.default.join(outputDest, newFileName))
                    .then(() => {
                    if (settings.storage === "s3" && process.env.NODE_ENV !== "test") {
                        ops.push((0, upload_file_1.uploadFile)(settings, path_1.default.join(outputDest, newFileName), newFileName));
                    }
                }));
            });
        });
        try {
            yield Promise.all(ops);
            return {
                createdFiles,
            };
        }
        catch (e) {
            console.error(e);
            throw new Error("Photonify: Error processing images");
        }
    });
}
exports.processFiles = processFiles;
