import {
    S3Client,
    CreateMultipartUploadCommand,
    UploadPartCopyCommand,
    AbortMultipartUploadCommand,
    ListPartsCommand,
    CompleteMultipartUploadCommand,
    CompleteMultipartUploadCommandInput,
    UploadPartCopyCommandOutput,
    CompletedPart,
    AbortMultipartUploadCommandInput,
    CreateMultipartUploadCommandInput,
    CompleteMultipartUploadCommandOutput,
    AbortMultipartUploadCommandOutput,
    UploadPartCopyCommandInput,
} from '@aws-sdk/client-s3';
import { AbortSignal } from '@aws-sdk/types';
import Bottleneck from 'bottleneck';
import { from, Subject } from 'rxjs';

const COPY_PART_SIZE_MINIMUM_BYTES = 5242880; // 5MB in bytes
const DEFAULT_COPY_PART_SIZE_BYTES = 50000000; // 50 MB in bytes
const DEFAULT_COPIED_OBJECT_PERMISSIONS = 'private';

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

export class ErrorWithDetails extends Error {
    details?: any;
}

export interface CopyObjectMultipartOptions {
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

export interface Options {
    abortController?: AbortController;
    logger?: Logger;
    s3Client: S3Client;
    params: CopyObjectMultipartOptions;
    maxConcurrentParts?: number;
}

export class CopyMultipart {
    s3Client: S3Client;
    logger: Logger;
    abortController: AbortController;
    abortSignal: AbortSignal;
    params: CopyObjectMultipartOptions;
    processedBytes: number;
    bottleneck: Bottleneck;

    processedBytesSubject: Subject<number>;

    uploadId: string | undefined;

    constructor(options: Options) {
        this.logger = options.logger || getDefaultLogger();
        this.s3Client = options.s3Client;
        this.params = options.params;
        this.abortController = options.abortController ?? new AbortController();
        this.abortSignal = this.abortController.signal as AbortSignal;
        this.processedBytes = 0;
        this.processedBytesSubject = new Subject<number>();
        this.bottleneck = new Bottleneck({
            maxConcurrent: options.maxConcurrentParts ?? 4,
        });
    }

    public observableProcessedBytes() {
        return from(this.processedBytesSubject);
    }

    async abort(): Promise<void> {
        /**
         * Abort stops all new uploads and immediately exits the top level promise on this.done()
         * Concurrent threads in flight clean up eventually.
         */
        this.abortController.abort();
    }

    public async done(): Promise<
        CompleteMultipartUploadCommandOutput | AbortMultipartUploadCommandOutput
    > {
        return await Promise.race([
            this.__doMultipartCopy(),
            this.__abortTimeout(this.abortSignal),
        ]);
    }

    private async __doMultipartCopy(): Promise<CompleteMultipartUploadCommandOutput> {
        return this.copyObjectMultipart(this.params, '');
    }

    private async __abortTimeout(
        abortSignal: AbortSignal
    ): Promise<AbortMultipartUploadCommandOutput> {
        return new Promise((resolve, reject) => {
            abortSignal.onabort = () => {
                const abortError = new Error('Upload aborted.');
                abortError.name = 'AbortError';

                this.abortMultipartCopy(
                    this.params.destination_bucket,
                    this.params.copied_object_name,
                    this.uploadId,
                    ''
                ).then(() => {
                    reject(abortError);
                });
            };
        });
    }

    /**
     * Throws the error of initiateMultipartCopy in case such occures
     * @param {*} options an object of parameters obligated to hold the below keys
     * (note that copy_part_size_bytes, copied_object_permissions, expiration_period are optional and will be assigned with default values if not given)
     * @param {*} request_context optional parameter for logging purposes
     */
    private async copyObjectMultipart(
        {
            source_bucket,
            object_key,
            destination_bucket,
            copied_object_name,
            object_size,
            copy_part_size_bytes,
            copied_object_permissions,
            expiration_period,
            server_side_encryption,
            content_type,
            content_disposition,
            content_encoding,
            content_language,
            metadata,
            cache_control,
            storage_class,
        }: CopyObjectMultipartOptions,
        request_context: string
    ) {
        const upload_id = await this.initiateMultipartCopy(
            destination_bucket,
            copied_object_name,
            copied_object_permissions,
            expiration_period,
            request_context,
            server_side_encryption,
            content_type,
            content_disposition,
            content_encoding,
            content_language,
            metadata,
            cache_control,
            storage_class
        );

        this.uploadId = upload_id;

        const partitionsRangeArray = calculatePartitionsRangeArray(
            object_size,
            copy_part_size_bytes
        );
        const copyPartFunctionsArray: Promise<UploadPartCopyCommandOutput>[] =
            [];

        partitionsRangeArray.forEach((partitionRange, index) => {
            const copyPartFunction = () => {
                return this.copyPart(
                    source_bucket,
                    destination_bucket,
                    index + 1,
                    object_key,
                    partitionRange,
                    copied_object_name,
                    upload_id
                );
            };
            const promise = this.bottleneck.schedule(copyPartFunction);
            copyPartFunctionsArray.push(promise);
        });

        return Promise.all(copyPartFunctionsArray)
            .then((copy_results) => {
                this.logger.info({
                    msg: `copied all parts successfully: ${JSON.stringify(
                        copy_results
                    )}`,
                    context: request_context,
                });

                const copyResultsForCopyCompletion =
                    prepareResultsForCopyCompletion(copy_results);
                return this.completeMultipartCopy(
                    destination_bucket,
                    copyResultsForCopyCompletion,
                    copied_object_name,
                    upload_id,
                    request_context
                );
            })
            .catch(() => {
                return this.abortMultipartCopy(
                    destination_bucket,
                    copied_object_name,
                    upload_id,
                    request_context
                );
            });
    }

    private initiateMultipartCopy(
        destination_bucket: string,
        copied_object_name: string,
        copied_object_permissions?: string,
        expiration_period?: Date,
        request_context?: string,
        server_side_encryption?: string,
        content_type?: string,
        content_disposition?: string,
        content_encoding?: string,
        content_language?: string,
        metadata?: Record<string, string>,
        cache_control?: string,
        storage_class?: string
    ) {
        const params: CreateMultipartUploadCommandInput = {
            Bucket: destination_bucket,
            Key: copied_object_name,
        };

        params.ACL =
            copied_object_permissions || DEFAULT_COPIED_OBJECT_PERMISSIONS;
        if (expiration_period) params.Expires = expiration_period;
        if (server_side_encryption)
            params.ServerSideEncryption = server_side_encryption;
        if (content_type) params.ContentType = content_type;
        if (content_disposition)
            params.ContentDisposition = content_disposition;
        if (content_encoding) params.ContentEncoding = content_encoding;
        if (content_language) params.ContentLanguage = content_language;
        if (metadata) params.Metadata = metadata;
        if (cache_control) params.CacheControl = cache_control;
        if (storage_class) params.StorageClass = storage_class;

        const command = new CreateMultipartUploadCommand(params);

        return this.s3Client
            .send(command, {
                abortSignal: this.abortSignal,
            })
            .then((result) => {
                this.logger.info({
                    msg: `multipart copy initiated successfully: ${JSON.stringify(
                        result
                    )}`,
                    context: request_context,
                });
                return Promise.resolve(result.UploadId);
            })
            .catch((err) => {
                this.logger.error({
                    msg: 'multipart copy failed to initiate',
                    context: request_context,
                    error: err,
                });
                return Promise.reject(err);
            });
    }

    private copyPart(
        source_bucket: string,
        destination_bucket: string,
        part_number: number,
        object_key: string,
        partition: Partition,
        copied_object_name: string,
        upload_id: string | undefined
    ) {
        const encodedSourceKey = encodeURIComponent(
            `${source_bucket}/${object_key}`
        );
        const params: UploadPartCopyCommandInput = {
            Bucket: destination_bucket,
            CopySource: encodedSourceKey,
            CopySourceRange: 'bytes=' + partition.byteRange,
            Key: copied_object_name,
            PartNumber: part_number,
            UploadId: upload_id,
        };

        if (this.abortController.signal.aborted) {
            return Promise.reject('Aborted');
        }

        const command = new UploadPartCopyCommand(params);

        return this.s3Client
            .send(command, {
                abortSignal: this.abortSignal,
            })
            .then((result) => {
                this.logger.info({
                    msg: `CopyPart ${part_number} succeeded: ${JSON.stringify(
                        result
                    )}`,
                });
                this.processedBytes += partition.size;
                this.processedBytesSubject.next(this.processedBytes);
                return Promise.resolve(result);
            })
            .catch((err) => {
                this.logger.error({
                    msg: `CopyPart ${part_number} Failed: ${JSON.stringify(
                        err
                    )}`,
                    error: err,
                });
                return Promise.reject(err);
            });
    }

    private abortMultipartCopy(
        destination_bucket: string,
        copied_object_name: string,
        upload_id: string | undefined,
        request_context: string
    ) {
        const params: AbortMultipartUploadCommandInput = {
            Bucket: destination_bucket,
            Key: copied_object_name,
            UploadId: upload_id,
        };

        const command = new AbortMultipartUploadCommand(params);

        return this.s3Client
            .send(command, {
                abortSignal: this.abortSignal,
            })
            .then(() => {
                const listCommand = new ListPartsCommand(params);
                return this.s3Client.send(listCommand);
            })
            .catch((err) => {
                this.logger.error({
                    msg: 'abort multipart copy failed',
                    context: request_context,
                    error: err,
                });

                return Promise.reject(err);
            })
            .then((parts_list) => {
                if (parts_list.Parts && parts_list.Parts.length > 0) {
                    const err = new ErrorWithDetails(
                        'Abort procedure passed but copy parts were not removed'
                    );
                    err.details = parts_list;

                    this.logger.error({
                        msg: 'abort multipart copy failed, copy parts were not removed',
                        context: request_context,
                        error: err,
                    });

                    return Promise.reject(err);
                } else {
                    this.logger.info({
                        msg: `multipart copy aborted successfully: ${JSON.stringify(
                            parts_list
                        )}`,
                        context: request_context,
                    });

                    const err = new ErrorWithDetails('multipart copy aborted');
                    err.details = params;

                    return Promise.reject(err);
                }
            });
    }

    private completeMultipartCopy(
        destination_bucket: string,
        ETags_array: CompletedPart[],
        copied_object_name: string,
        upload_id: string | undefined,
        request_context: string
    ) {
        const params: CompleteMultipartUploadCommandInput = {
            Bucket: destination_bucket,
            Key: copied_object_name,
            MultipartUpload: {
                Parts: ETags_array,
            },
            UploadId: upload_id,
        };

        const command = new CompleteMultipartUploadCommand(params);

        return this.s3Client
            .send(command, {
                abortSignal: this.abortSignal,
            })
            .then((result) => {
                this.logger.info({
                    msg: `multipart copy completed successfully: ${JSON.stringify(
                        result
                    )}`,
                    context: request_context,
                });
                this.processedBytesSubject.complete();
                return Promise.resolve(result);
            })
            .catch((err) => {
                this.logger.error({
                    msg: 'Multipart upload failed',
                    context: request_context,
                    error: err,
                });
                this.processedBytesSubject.error(err);
                return Promise.reject(err);
            });
    }
}

function prepareResultsForCopyCompletion(
    copy_parts_results_array: UploadPartCopyCommandOutput[]
) {
    const resultArray: CompletedPart[] = [];

    copy_parts_results_array.forEach((copy_part, index) => {
        if (copy_part.CopyPartResult) {
            const newCopyPart: CompletedPart = {};
            newCopyPart.ETag = copy_part.CopyPartResult.ETag;
            newCopyPart.PartNumber = index + 1;
            resultArray.push(newCopyPart);
        }
    });

    return resultArray;
}

type Partition = {
    byteRange: string;
    size: number;
};

function calculatePartitionsRangeArray(
    object_size: number,
    copy_part_size_bytes?: number
) {
    const partitions: Partition[] = [];
    const copy_part_size = copy_part_size_bytes || DEFAULT_COPY_PART_SIZE_BYTES;
    const numOfPartitions = Math.floor(object_size / copy_part_size);
    const remainder = object_size % copy_part_size;
    let index: number, partition: string;

    for (index = 0; index < numOfPartitions; index++) {
        const nextIndex = index + 1;

        let start = 0,
            end = 0,
            size = 0;
        if (
            nextIndex === numOfPartitions &&
            remainder < COPY_PART_SIZE_MINIMUM_BYTES
        ) {
            start = index * copy_part_size;
            end = nextIndex * copy_part_size + remainder - 1;
            size = remainder;
        } else {
            start = index * copy_part_size;
            end = nextIndex * copy_part_size - 1;
            size = copy_part_size;
        }

        const byteRange = `${start}-${end}`;

        partitions.push({ byteRange, size });
    }

    if (numOfPartitions == 0 || remainder >= COPY_PART_SIZE_MINIMUM_BYTES) {
        const start = index * copy_part_size;
        const end = index * copy_part_size + remainder - 1;
        const size = remainder;

        const byteRange = `${start}-${end}`;

        partitions.push({ byteRange, size });
    }

    return partitions;
}

function getDefaultLogger() {
    const logger: Logger = {
        info: ({ msg, context }) => {
            //console.log(`${context}: ${msg}`);
        },
        error: ({ msg, error, context }) => {
            //console.error(`${context}: ${msg}`, error);
        },
    };
    return logger;
}
