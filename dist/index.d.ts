import * as _aws_sdk_client_s3 from '@aws-sdk/client-s3';
import { S3Client } from '@aws-sdk/client-s3';

interface Logger {
    info: (arg: LoggerInfoArgument) => any;
    error: (arg: LoggerErrorArgument) => any;
}
interface LoggerInfoArgument {
    msg: string;
    context?: string;
}
interface LoggerErrorArgument {
    msg: string;
    error?: ErrorWithDetails;
    context?: string;
}
declare class ErrorWithDetails extends Error {
    details?: any;
}
declare function init(client: S3Client, initialized_logger: Logger): void;
interface CopyObjectMultipartOptions {
    source_bucket: string;
    object_key: string;
    destination_bucket: string;
    copied_object_name: string;
    object_size: number;
    copy_part_size_bytes?: number;
    copied_object_permissions?: string;
    expiration_period?: Date;
    server_side_encryption?: string;
    content_type?: string;
    content_disposition?: string;
    content_encoding?: string;
    content_language?: string;
    metadata?: Record<string, string>;
    cache_control?: string;
    storage_class?: string;
}
/**
 * Throws the error of initiateMultipartCopy in case such occures
 * @param {*} options an object of parameters obligated to hold the below keys
 * (note that copy_part_size_bytes, copied_object_permissions, expiration_period are optional and will be assigned with default values if not given)
 * @param {*} request_context optional parameter for logging purposes
 */
declare function copyObjectMultipart({ source_bucket, object_key, destination_bucket, copied_object_name, object_size, copy_part_size_bytes, copied_object_permissions, expiration_period, server_side_encryption, content_type, content_disposition, content_encoding, content_language, metadata, cache_control, storage_class, }: CopyObjectMultipartOptions, request_context: string): Promise<_aws_sdk_client_s3.CompleteMultipartUploadCommandOutput>;

export { CopyObjectMultipartOptions, ErrorWithDetails, Logger, LoggerErrorArgument, LoggerInfoArgument, copyObjectMultipart, init };
