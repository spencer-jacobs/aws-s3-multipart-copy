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
} from "@aws-sdk/client-s3";
import * as _ from "lodash";

const COPY_PART_SIZE_MINIMUM_BYTES = 5242880; // 5MB in bytes
const DEFAULT_COPY_PART_SIZE_BYTES = 50000000; // 50 MB in bytes
const DEFAULT_COPIED_OBJECT_PERMISSIONS = "private";

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

let s3Client: S3Client;
let logger: Logger;

export function init(client: S3Client, initialized_logger: Logger) {
    s3Client = client;
    logger = initialized_logger;

    if (!(s3Client instanceof S3Client)) {
        throw new Error("Invalid S3Client object received");
    } else {
        if (
            logger &&
            typeof logger.info === "function" &&
            typeof logger.error === "function"
        ) {
            logger.info({ msg: "S3 client initialized successfully" });
        } else {
            throw new Error("Invalid logger object received");
        }
    }
}

export interface CopyObjectMultipartOptions {
    source_bucket: string;
    object_key: string;
    destination_bucket: string;
    copied_object_name: string;
    object_size: number;
    copy_part_size_bytes?: number;
    // copied_object_permissions?: any;
    // expiration_period?: any;
    // server_side_encryption?: string;
    // content_type?: string;
    // content_disposition?: string;
    // content_encoding?: string;
    // content_language?: string;
    // metadata?: Record<string, string>;
    // cache_control?: any;
    // storage_class?: any;
}

/**
 * Throws the error of initiateMultipartCopy in case such occures
 * @param {*} options an object of parameters obligated to hold the below keys
 * (note that copy_part_size_bytes, copied_object_permissions, expiration_period are optional and will be assigned with default values if not given)
 * @param {*} request_context optional parameter for logging purposes
 */
export async function copyObjectMultipart(
    {
        source_bucket,
        object_key,
        destination_bucket,
        copied_object_name,
        object_size,
        copy_part_size_bytes,
    }: // copied_object_permissions,
    // expiration_period,
    // server_side_encryption,
    // content_type,
    // content_disposition,
    // content_encoding,
    // content_language,
    // metadata,
    // cache_control,
    // storage_class,
    CopyObjectMultipartOptions,
    request_context: string
) {
    const upload_id = await initiateMultipartCopy(
        destination_bucket,
        copied_object_name,
        // copied_object_permissions,
        // expiration_period,
        request_context
        // server_side_encryption,
        // content_type,
        // content_disposition,
        // content_encoding,
        // content_language,
        // metadata,
        // cache_control,
        // storage_class
    );
    const partitionsRangeArray = calculatePartitionsRangeArray(
        object_size,
        copy_part_size_bytes
    );
    const copyPartFunctionsArray: ReturnType<typeof copyPart>[] = [];

    partitionsRangeArray.forEach((partitionRange, index) => {
        copyPartFunctionsArray.push(
            copyPart(
                source_bucket,
                destination_bucket,
                index + 1,
                object_key,
                partitionRange,
                copied_object_name,
                upload_id
            )
        );
    });

    return Promise.all(copyPartFunctionsArray)
        .then((copy_results) => {
            logger.info({
                msg: `copied all parts successfully: ${JSON.stringify(
                    copy_results
                )}`,
                context: request_context,
            });

            const copyResultsForCopyCompletion =
                prepareResultsForCopyCompletion(copy_results);
            return completeMultipartCopy(
                destination_bucket,
                copyResultsForCopyCompletion,
                copied_object_name,
                upload_id,
                request_context
            );
        })
        .catch(() => {
            return abortMultipartCopy(
                destination_bucket,
                copied_object_name,
                upload_id,
                request_context
            );
        });
}

function initiateMultipartCopy(
    destination_bucket: string,
    copied_object_name: string,
    // copied_object_permissions?: any,
    // expiration_period?: any,
    request_context?: string
    // server_side_encryption?: string,
    // content_type?: string,
    // content_disposition?: string,
    // content_encoding?: string,
    // content_language?: string,
    // metadata?: Record<string, string>,
    // cache_control?: any,
    // storage_class?: any
) {
    const params: CompleteMultipartUploadCommandInput = {
        UploadId: undefined,
        Bucket: destination_bucket,
        Key: copied_object_name,
    };

    delete params.UploadId;

    const command = new CreateMultipartUploadCommand(params);

    return s3Client
        .send(command)
        .then((result) => {
            logger.info({
                msg: `multipart copy initiated successfully: ${JSON.stringify(
                    result
                )}`,
                context: request_context,
            });
            return Promise.resolve(result.UploadId);
        })
        .catch((err) => {
            logger.error({
                msg: "multipart copy failed to initiate",
                context: request_context,
                error: err,
            });
            return Promise.reject(err);
        });
}

function copyPart(
    source_bucket: string,
    destination_bucket: string,
    part_number: number,
    object_key: string,
    partition_range: string,
    copied_object_name: string,
    upload_id: string | undefined
) {
    const encodedSourceKey = encodeURIComponent(
        `${source_bucket}/${object_key}`
    );
    const params = {
        Bucket: destination_bucket,
        CopySource: encodedSourceKey,
        CopySourceRange: "bytes=" + partition_range,
        Key: copied_object_name,
        PartNumber: part_number,
        UploadId: upload_id,
    };

    const command = new UploadPartCopyCommand(params);

    return s3Client
        .send(command)
        .then((result) => {
            logger.info({
                msg: `CopyPart ${part_number} succeeded: ${JSON.stringify(
                    result
                )}`,
            });
            return Promise.resolve(result);
        })
        .catch((err) => {
            logger.error({
                msg: `CopyPart ${part_number} Failed: ${JSON.stringify(err)}`,
                error: err,
            });
            return Promise.reject(err);
        });
}

function abortMultipartCopy(
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

    return s3Client
        .send(command)
        .then(() => {
            const listCommand = new ListPartsCommand(params);
            return s3Client.send(listCommand);
        })
        .catch((err) => {
            logger.error({
                msg: "abort multipart copy failed",
                context: request_context,
                error: err,
            });

            return Promise.reject(err);
        })
        .then((parts_list) => {
            if (parts_list.Parts && parts_list.Parts.length > 0) {
                const err = new ErrorWithDetails(
                    "Abort procedure passed but copy parts were not removed"
                );
                err.details = parts_list;

                logger.error({
                    msg: "abort multipart copy failed, copy parts were not removed",
                    context: request_context,
                    error: err,
                });

                return Promise.reject(err);
            } else {
                logger.info({
                    msg: `multipart copy aborted successfully: ${JSON.stringify(
                        parts_list
                    )}`,
                    context: request_context,
                });

                const err = new ErrorWithDetails("multipart copy aborted");
                err.details = params;

                return Promise.reject(err);
            }
        });
}

function completeMultipartCopy(
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

    return s3Client
        .send(command)
        .then((result) => {
            logger.info({
                msg: `multipart copy completed successfully: ${JSON.stringify(
                    result
                )}`,
                context: request_context,
            });
            return Promise.resolve(result);
        })
        .catch((err) => {
            logger.error({
                msg: "Multipart upload failed",
                context: request_context,
                error: err,
            });
            return Promise.reject(err);
        });
}

function calculatePartitionsRangeArray(
    object_size: number,
    copy_part_size_bytes?: number
) {
    const partitions: string[] = [];
    const copy_part_size = copy_part_size_bytes || DEFAULT_COPY_PART_SIZE_BYTES;
    const numOfPartitions = Math.floor(object_size / copy_part_size);
    const remainder = object_size % copy_part_size;
    let index: number, partition: string;

    for (index = 0; index < numOfPartitions; index++) {
        const nextIndex = index + 1;
        if (
            nextIndex === numOfPartitions &&
            remainder < COPY_PART_SIZE_MINIMUM_BYTES
        ) {
            partition =
                index * copy_part_size +
                "-" +
                (nextIndex * copy_part_size + remainder - 1);
        } else {
            partition =
                index * copy_part_size + "-" + (nextIndex * copy_part_size - 1);
        }
        partitions.push(partition);
    }

    if (numOfPartitions == 0 || remainder >= COPY_PART_SIZE_MINIMUM_BYTES) {
        partition =
            index * copy_part_size +
            "-" +
            (index * copy_part_size + remainder - 1);
        partitions.push(partition);
    }

    return partitions;
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

module.exports = {
    init,
    copyObjectMultipart,
    ErrorWithDetails,
};
