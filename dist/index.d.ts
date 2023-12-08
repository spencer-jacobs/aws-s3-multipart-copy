import * as rxjs from 'rxjs';
import { Subject } from 'rxjs';
import { S3Client, CompleteMultipartUploadCommandOutput, AbortMultipartUploadCommandOutput } from '@aws-sdk/client-s3';
import { AbortSignal } from '@aws-sdk/types';
import Bottleneck from 'bottleneck';

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
interface Options {
    abortController?: AbortController;
    logger?: Logger;
    s3Client: S3Client;
    params: CopyObjectMultipartOptions;
    maxConcurrentParts?: number;
}
declare class CopyMultipart {
    s3Client: S3Client;
    logger: Logger;
    abortController: AbortController;
    abortSignal: AbortSignal;
    params: CopyObjectMultipartOptions;
    processedBytes: number;
    bottleneck: Bottleneck;
    processedBytesSubject: Subject<number>;
    uploadId: string | undefined;
    constructor(options: Options);
    observableProcessedBytes(): rxjs.Observable<number>;
    abort(): Promise<void>;
    done(): Promise<CompleteMultipartUploadCommandOutput | AbortMultipartUploadCommandOutput>;
    private __doMultipartCopy;
    private __abortTimeout;
    /**
     * Throws the error of initiateMultipartCopy in case such occures
     * @param {*} options an object of parameters obligated to hold the below keys
     * (note that copy_part_size_bytes, copied_object_permissions, expiration_period are optional and will be assigned with default values if not given)
     * @param {*} request_context optional parameter for logging purposes
     */
    private copyObjectMultipart;
    private initiateMultipartCopy;
    private copyPart;
    private abortMultipartCopy;
    private completeMultipartCopy;
}

export { CopyMultipart, CopyObjectMultipartOptions, ErrorWithDetails, Logger, LoggerErrorArgument, LoggerInfoArgument, Options };
