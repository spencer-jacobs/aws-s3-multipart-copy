"use strict";Object.defineProperty(exports, "__esModule", {value: true});var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/copy-object-multipart.ts






var _clients3 = require('@aws-sdk/client-s3');
var COPY_PART_SIZE_MINIMUM_BYTES = 5242880;
var DEFAULT_COPY_PART_SIZE_BYTES = 5e7;
var DEFAULT_COPIED_OBJECT_PERMISSIONS = "private";
var ErrorWithDetails = class extends Error {
};
var CopyMultipart = class {
  constructor(options) {
    var _a;
    this.logger = options.logger || getDefaultLogger();
    this.s3Client = options.s3Client;
    this.params = options.params;
    this.abortController = (_a = options.abortController) != null ? _a : new AbortController();
  }
  abort() {
    return __async(this, null, function* () {
      this.abortController.abort();
    });
  }
  done() {
    return __async(this, null, function* () {
      return yield Promise.race([
        this.__doMultipartCopy(),
        this.__abortTimeout(this.abortController.signal)
      ]);
    });
  }
  __doMultipartCopy() {
    return __async(this, null, function* () {
      return this.copyObjectMultipart(this.params, "");
    });
  }
  __abortTimeout(abortSignal) {
    return __async(this, null, function* () {
      return new Promise((resolve, reject) => {
        abortSignal.onabort = () => {
          const abortError = new Error("Upload aborted.");
          abortError.name = "AbortError";
          this.abortMultipartCopy(
            this.params.destination_bucket,
            this.params.copied_object_name,
            this.uploadId,
            ""
          ).then(() => {
            reject(abortError);
          });
        };
      });
    });
  }
  copyObjectMultipart(_0, _1) {
    return __async(this, arguments, function* ({
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
      storage_class
    }, request_context) {
      const upload_id = yield this.initiateMultipartCopy(
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
      const copyPartFunctionsArray = [];
      partitionsRangeArray.forEach((partitionRange, index) => {
        copyPartFunctionsArray.push(
          this.copyPart(
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
      return Promise.all(copyPartFunctionsArray).then((copy_results) => {
        this.logger.info({
          msg: `copied all parts successfully: ${JSON.stringify(
            copy_results
          )}`,
          context: request_context
        });
        if (copy_results.length === 1) {
          const result = {
            $metadata: {},
            Bucket: this.params.destination_bucket,
            Key: this.params.object_key
          };
          return Promise.resolve(result);
        }
        const copyResultsForCopyCompletion = prepareResultsForCopyCompletion(copy_results);
        return this.completeMultipartCopy(
          destination_bucket,
          copyResultsForCopyCompletion,
          copied_object_name,
          upload_id,
          request_context
        );
      }).catch(() => {
        return this.abortMultipartCopy(
          destination_bucket,
          copied_object_name,
          upload_id,
          request_context
        );
      });
    });
  }
  initiateMultipartCopy(destination_bucket, copied_object_name, copied_object_permissions, expiration_period, request_context, server_side_encryption, content_type, content_disposition, content_encoding, content_language, metadata, cache_control, storage_class) {
    const params = {
      Bucket: destination_bucket,
      Key: copied_object_name
    };
    params.ACL = copied_object_permissions || DEFAULT_COPIED_OBJECT_PERMISSIONS;
    if (expiration_period)
      params.Expires = expiration_period;
    if (server_side_encryption)
      params.ServerSideEncryption = server_side_encryption;
    if (content_type)
      params.ContentType = content_type;
    if (content_disposition)
      params.ContentDisposition = content_disposition;
    if (content_encoding)
      params.ContentEncoding = content_encoding;
    if (content_language)
      params.ContentLanguage = content_language;
    if (metadata)
      params.Metadata = metadata;
    if (cache_control)
      params.CacheControl = cache_control;
    if (storage_class)
      params.StorageClass = storage_class;
    const command = new (0, _clients3.CreateMultipartUploadCommand)(params);
    return this.s3Client.send(command).then((result) => {
      this.logger.info({
        msg: `multipart copy initiated successfully: ${JSON.stringify(
          result
        )}`,
        context: request_context
      });
      return Promise.resolve(result.UploadId);
    }).catch((err) => {
      this.logger.error({
        msg: "multipart copy failed to initiate",
        context: request_context,
        error: err
      });
      return Promise.reject(err);
    });
  }
  copyPart(source_bucket, destination_bucket, part_number, object_key, partition_range, copied_object_name, upload_id) {
    const encodedSourceKey = encodeURIComponent(
      `${source_bucket}/${object_key}`
    );
    const params = {
      Bucket: destination_bucket,
      CopySource: encodedSourceKey,
      CopySourceRange: "bytes=" + partition_range,
      Key: copied_object_name,
      PartNumber: part_number,
      UploadId: upload_id
    };
    if (this.abortController.signal.aborted) {
      return Promise.reject("Aborted");
    }
    const command = new (0, _clients3.UploadPartCopyCommand)(params);
    return this.s3Client.send(command).then((result) => {
      this.logger.info({
        msg: `CopyPart ${part_number} succeeded: ${JSON.stringify(
          result
        )}`
      });
      return Promise.resolve(result);
    }).catch((err) => {
      this.logger.error({
        msg: `CopyPart ${part_number} Failed: ${JSON.stringify(
          err
        )}`,
        error: err
      });
      return Promise.reject(err);
    });
  }
  abortMultipartCopy(destination_bucket, copied_object_name, upload_id, request_context) {
    const params = {
      Bucket: destination_bucket,
      Key: copied_object_name,
      UploadId: upload_id
    };
    const command = new (0, _clients3.AbortMultipartUploadCommand)(params);
    return this.s3Client.send(command).then(() => {
      const listCommand = new (0, _clients3.ListPartsCommand)(params);
      return this.s3Client.send(listCommand);
    }).catch((err) => {
      this.logger.error({
        msg: "abort multipart copy failed",
        context: request_context,
        error: err
      });
      return Promise.reject(err);
    }).then((parts_list) => {
      if (parts_list.Parts && parts_list.Parts.length > 0) {
        const err = new ErrorWithDetails(
          "Abort procedure passed but copy parts were not removed"
        );
        err.details = parts_list;
        this.logger.error({
          msg: "abort multipart copy failed, copy parts were not removed",
          context: request_context,
          error: err
        });
        return Promise.reject(err);
      } else {
        this.logger.info({
          msg: `multipart copy aborted successfully: ${JSON.stringify(
            parts_list
          )}`,
          context: request_context
        });
        const err = new ErrorWithDetails("multipart copy aborted");
        err.details = params;
        return Promise.reject(err);
      }
    });
  }
  completeMultipartCopy(destination_bucket, ETags_array, copied_object_name, upload_id, request_context) {
    const params = {
      Bucket: destination_bucket,
      Key: copied_object_name,
      MultipartUpload: {
        Parts: ETags_array
      },
      UploadId: upload_id
    };
    const command = new (0, _clients3.CompleteMultipartUploadCommand)(params);
    return this.s3Client.send(command).then((result) => {
      this.logger.info({
        msg: `multipart copy completed successfully: ${JSON.stringify(
          result
        )}`,
        context: request_context
      });
      return Promise.resolve(result);
    }).catch((err) => {
      this.logger.error({
        msg: `Multipart upload failed: ${JSON.stringify(params)}`,
        context: request_context,
        error: err
      });
      return Promise.reject(err);
    });
  }
};
function prepareResultsForCopyCompletion(copy_parts_results_array) {
  const resultArray = [];
  copy_parts_results_array.forEach((copy_part, index) => {
    if (copy_part.CopyPartResult) {
      const newCopyPart = {};
      newCopyPart.ETag = copy_part.CopyPartResult.ETag;
      newCopyPart.PartNumber = index + 1;
      resultArray.push(newCopyPart);
    }
  });
  return resultArray;
}
function calculatePartitionsRangeArray(object_size, copy_part_size_bytes) {
  const partitions = [];
  const copy_part_size = copy_part_size_bytes || DEFAULT_COPY_PART_SIZE_BYTES;
  const numOfPartitions = Math.floor(object_size / copy_part_size);
  const remainder = object_size % copy_part_size;
  let index, partition;
  for (index = 0; index < numOfPartitions; index++) {
    const nextIndex = index + 1;
    if (nextIndex === numOfPartitions && remainder < COPY_PART_SIZE_MINIMUM_BYTES) {
      partition = index * copy_part_size + "-" + (nextIndex * copy_part_size + remainder - 1);
    } else {
      partition = index * copy_part_size + "-" + (nextIndex * copy_part_size - 1);
    }
    partitions.push(partition);
  }
  if (numOfPartitions == 0 || remainder >= COPY_PART_SIZE_MINIMUM_BYTES) {
    partition = index * copy_part_size + "-" + (index * copy_part_size + remainder - 1);
    partitions.push(partition);
  }
  return partitions;
}
function getDefaultLogger() {
  const logger = {
    info: ({ msg, context }) => {
    },
    error: ({ msg, error, context }) => {
    }
  };
  return logger;
}



exports.CopyMultipart = CopyMultipart; exports.ErrorWithDetails = ErrorWithDetails;
//# sourceMappingURL=index.js.map