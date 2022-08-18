import { S3Client } from "@aws-sdk/client-s3";
export interface Logger {
    info: (arg: LoggerInfoArgument) => any;
    error: (arg: LoggerErrorArgument) => any;
}
export interface LoggerInfoArgument {
    msg: string;
    context?: string;
}
export interface LoggerErrorArgument {
    msg: string;
    error?: ErrorWithDetails;
    context?: string;
}
export declare class ErrorWithDetails extends Error {
    details?: any;
}
export declare function init(client: S3Client, initialized_logger: Logger): void;
export interface CopyObjectMultipartOptions {
    source_bucket: string;
    object_key: string;
    destination_bucket: string;
    copied_object_name: string;
    object_size: number;
    copy_part_size_bytes?: number;
}
/**
 * Throws the error of initiateMultipartCopy in case such occures
 * @param {*} options an object of parameters obligated to hold the below keys
 * (note that copy_part_size_bytes, copied_object_permissions, expiration_period are optional and will be assigned with default values if not given)
 * @param {*} request_context optional parameter for logging purposes
 */
export declare function copyObjectMultipart({ source_bucket, object_key, destination_bucket, copied_object_name, object_size, copy_part_size_bytes, }: CopyObjectMultipartOptions, request_context: string): Promise<import("@aws-sdk/client-s3").CompleteMultipartUploadCommandOutput>;
