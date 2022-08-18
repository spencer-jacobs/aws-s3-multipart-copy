"use strict";

let bunyan = require("bunyan"),
    sinon = require("sinon"),
    should = require("should"),
    deepCopy = require("deepcopy"),
    rewire = require("rewire"),
    s3Module = rewire("../../src/copy-object-multipart"),
    {
        S3Client,
        CreateMultipartUploadCommand,
        AbortMultipartUploadCommand,
        CompleteMultipartUploadCommand,
        UploadPartCopyCommand,
        ListPartsCommand,
    } = require("@aws-sdk/client-s3"),
    pkginfo = require("pkginfo")(module, "version"),
    testData = require("../utils/unit-tests-data"),
    APP_VERSION = module.exports.version,
    logger = bunyan.createLogger({
        name: "copy-object-multipart",
        level: "info",
        version: APP_VERSION,
        logType: "copy-object-multipart-log",
        serializers: { err: bunyan.stdSerializers.err },
    });

let loggerInfoSpy, loggerErrorSpy, sendStub, listPartsStub, s3Client;

let createMultipartUploadStubCallCount = 0;
let createMultipartUploadArgs = [];
let abortMultipartUploadStubCallCount = 0;
let abortMultipartUploadArgs = [];
let completeMultipartUploadStubCallCount = 0;
let completeMultipartUploadArgs = [];
let uploadPartCopyStubCallCount = 0;
let uploadPartCopyArgs = [];
let listPartsStubCallCount = 0;
let listPartsArgs = [];

describe("AWS S3 multipart copy client unit tests", function () {
    before(() => {
        loggerInfoSpy = sinon.spy(logger, "info");
        loggerErrorSpy = sinon.spy(logger, "error");
    });

    beforeEach(() => {
        createMultipartUploadStubCallCount = 0;
        uploadPartCopyStubCallCount = 0;
        completeMultipartUploadStubCallCount = 0;
        abortMultipartUploadStubCallCount = 0;
        listPartsStubCallCount = 0;

        createMultipartUploadArgs = [];
        uploadPartCopyArgs = [];
        completeMultipartUploadArgs = [];
        abortMultipartUploadArgs = [];
        listPartsArgs = [];
    });

    afterEach(() => {
        sinon.reset();
    });

    after(() => {
        sinon.restore();
    });

    describe("Testing init function", function () {
        it("Should pass when given valid s3 and logger objects", function () {
            s3Client = new S3Client();

            s3Module.init(s3Client, logger);

            should(loggerInfoSpy.calledOnce).equal(true);
            should(loggerInfoSpy.args[0][0]).eql({
                msg: "S3 client initialized successfully",
            });
            should(s3Module.__get__("s3Client")).equal(s3Client);
        });

        it("Should throw error when given an invalid s3 object", function () {
            let nots3Client = [];
            let expected_error = new Error("Invalid S3Client object received");

            try {
                s3Module.init(nots3Client, logger);
            } catch (err) {
                should(loggerInfoSpy.notCalled).equal(true);
                should(err).eql(expected_error);
            }
        });

        it("Should throw error when s3 object is not passed", function () {
            let expected_error = new Error("Invalid S3Client object received");

            try {
                s3Module.init(undefined, logger);
            } catch (err) {
                should(loggerInfoSpy.notCalled).equal(true);
                should(err).eql(expected_error);
            }
        });

        it("Should throw error when given an invalid logger object", function () {
            let notLogger = [];
            let s3Client = new S3Client();
            let expected_error = new Error("Invalid logger object received");

            try {
                s3Module.init(s3Client, notLogger);
            } catch (err) {
                should(loggerInfoSpy.notCalled).equal(true);
                should(err).eql(expected_error);
            }
        });

        it("Should throw error when logger object is not passed", function () {
            s3Client = new S3Client();
            let expected_error = new Error("Invalid logger object received");

            try {
                s3Module.init(s3Client, undefined);
            } catch (err) {
                should(loggerInfoSpy.notCalled).equal(true);
                should(err).eql(expected_error);
            }
        });
    });

    describe("Testing copyObjectMultipart", function () {
        before(() => {
            s3Client = new S3Client();
            s3Module.init(s3Client, logger);
            loggerInfoSpy.resetHistory();
            loggerErrorSpy.resetHistory();
            sendStub = sinon.stub(s3Client, "send");
        });

        beforeEach(() => {
            sendStub.callsFake((command, options) => {
                if (command instanceof CreateMultipartUploadCommand) {
                    createMultipartUploadStubCallCount++;
                    createMultipartUploadArgs.push(command.input);
                    return testData.createMultipartUploadStub_positive_response;
                } else if (command instanceof UploadPartCopyCommand) {
                    uploadPartCopyStubCallCount++;
                    uploadPartCopyArgs.push(command.input);
                    return testData.uploadPartCopyStub_positive_response;
                } else if (command instanceof CompleteMultipartUploadCommand) {
                    completeMultipartUploadStubCallCount++;
                    completeMultipartUploadArgs.push(command.input);
                    return testData.completeMultipartUploadStub_positive_response;
                } else if (command instanceof AbortMultipartUploadCommand) {
                    abortMultipartUploadStubCallCount++;
                    abortMultipartUploadArgs.push(command.input);
                    return testData.abortMultipartUploadStub_positive_response;
                } else if (command instanceof ListPartsCommand) {
                    listPartsStubCallCount++;
                    listPartsArgs.push(command.input);
                    return testData.listPartsStub_positive_response;
                }
            });
        });

        it("Should succeed with all variables passed", function () {
            return s3Module
                .copyObjectMultipart(
                    testData.full_request_options,
                    testData.request_context
                )
                .then(() => {
                    should(loggerInfoSpy.callCount).equal(5);
                    should(loggerInfoSpy.args[0][0]).eql({
                        msg:
                            "multipart copy initiated successfully: " +
                            JSON.stringify({ UploadId: "1a2b3c4d" }),
                        context: "request_context",
                    });

                    should(createMultipartUploadStubCallCount).equal(1);
                    should(createMultipartUploadArgs[0]).eql(
                        testData.expected_createMultipartUpload_args
                    );
                    should(uploadPartCopyStubCallCount).equal(2);
                    should(uploadPartCopyArgs[0]).eql(
                        testData.expected_uploadPartCopy_firstCallArgs
                    );
                    should(uploadPartCopyArgs[1]).eql(
                        testData.expected_uploadPartCopy_secondCallArgs
                    );
                    should(completeMultipartUploadStubCallCount).equal(1);
                    should(completeMultipartUploadArgs[0]).eql(
                        testData.expected_completeMultipartUploadStub_args
                    );
                });
        });

        it("Should succeed with all mandatory variables passed", function () {
            let expected_uploadPartCopy_secondCallArgs = deepCopy(
                testData.expected_uploadPartCopy_secondCallArgs
            );
            expected_uploadPartCopy_secondCallArgs.CopySourceRange =
                "bytes=50000000-99999999";

            let expected_createMultipartUpload_args = {
                Bucket: "destination_bucket",
                Key: "copied_object_name",
                ACL: "private",
            };

            return s3Module
                .copyObjectMultipart(
                    testData.partial_request_options,
                    testData.request_context
                )
                .then(() => {
                    should(loggerInfoSpy.callCount).equal(5);
                    should(loggerInfoSpy.args[0][0]).eql({
                        msg:
                            "multipart copy initiated successfully: " +
                            JSON.stringify({ UploadId: "1a2b3c4d" }),
                        context: "request_context",
                    });
                    should(createMultipartUploadStubCallCount).equal(1);
                    should(createMultipartUploadArgs[0]).eql(
                        expected_createMultipartUpload_args
                    );
                    should(uploadPartCopyStubCallCount).equal(2);
                    should(uploadPartCopyArgs[0]).eql(
                        testData.expected_uploadPartCopy_firstCallArgs
                    );
                    should(uploadPartCopyArgs[1]).eql(
                        expected_uploadPartCopy_secondCallArgs
                    );
                    should(completeMultipartUploadStubCallCount).equal(1);
                    should(completeMultipartUploadArgs[0]).eql(
                        testData.expected_completeMultipartUploadStub_args
                    );
                });
        });

        it("Should url-encode CopySource key", function () {
            const partial_request_options = deepCopy(
                testData.partial_request_options
            );
            partial_request_options.object_key = "+?=/&_-.txt";
            const expected_uploadPartCopy_firstCallArgs = deepCopy(
                testData.expected_uploadPartCopy_firstCallArgs
            );
            expected_uploadPartCopy_firstCallArgs.CopySource =
                "source_bucket%2F%2B%3F%3D%2F%26_-.txt";
            const expected_uploadPartCopy_secondCallArgs = deepCopy(
                testData.expected_uploadPartCopy_secondCallArgs
            );
            expected_uploadPartCopy_secondCallArgs.CopySource =
                "source_bucket%2F%2B%3F%3D%2F%26_-.txt";
            expected_uploadPartCopy_secondCallArgs.CopySourceRange =
                "bytes=50000000-99999999";

            return s3Module
                .copyObjectMultipart(
                    partial_request_options,
                    testData.request_context
                )
                .then(() => {
                    should(uploadPartCopyArgs[0]).eql(
                        expected_uploadPartCopy_firstCallArgs
                    );
                    should(uploadPartCopyArgs[1]).eql(
                        expected_uploadPartCopy_secondCallArgs
                    );
                });
        });

        it("Should succeed with all variables passed and object_size is smaller then copy_part_size_bytes", function () {
            let full_request_options = deepCopy(testData.full_request_options);
            full_request_options.object_size = 25000000;
            let expected_uploadPartCopy_firstCallArgs = deepCopy(
                testData.expected_uploadPartCopy_firstCallArgs
            );
            expected_uploadPartCopy_firstCallArgs.CopySourceRange =
                "bytes=0-24999999";
            let expected_completeMultipartUploadStub_args = deepCopy(
                testData.expected_completeMultipartUploadStub_args
            );
            expected_completeMultipartUploadStub_args.MultipartUpload.Parts = [
                { ETag: "1a1b2s3d2f1e2g3sfsgdsg", PartNumber: 1 },
            ];

            return s3Module
                .copyObjectMultipart(
                    full_request_options,
                    testData.request_context
                )
                .then(() => {
                    should(loggerInfoSpy.callCount).equal(4);
                    should(loggerInfoSpy.args[0][0]).eql({
                        msg:
                            "multipart copy initiated successfully: " +
                            JSON.stringify({ UploadId: "1a2b3c4d" }),
                        context: "request_context",
                    });
                    should(createMultipartUploadStubCallCount).equal(1);
                    should(createMultipartUploadArgs[0]).eql(
                        testData.expected_createMultipartUpload_args
                    );
                    should(uploadPartCopyStubCallCount).equal(1);
                    should(uploadPartCopyArgs[0]).eql(
                        expected_uploadPartCopy_firstCallArgs
                    );
                    should(completeMultipartUploadStubCallCount).equal(1);
                    should(completeMultipartUploadArgs[0]).eql(
                        expected_completeMultipartUploadStub_args
                    );
                });
        });

        it("Should fail due to createMultipartUpload error and not call abortMultipartCopy", function () {
            sendStub.callsFake((command, options) => {
                if (command instanceof CreateMultipartUploadCommand) {
                    createMultipartUploadStubCallCount++;
                    createMultipartUploadArgs.push(command.input);
                    return testData.all_stubs_error_response;
                } else if (command instanceof UploadPartCopyCommand) {
                    uploadPartCopyStubCallCount++;
                    uploadPartCopyArgs.push(command.input);
                    return testData.uploadPartCopyStub_positive_response;
                } else if (command instanceof CompleteMultipartUploadCommand) {
                    completeMultipartUploadStubCallCount++;
                    completeMultipartUploadArgs.push(command.input);
                    return testData.completeMultipartUploadStub_positive_response;
                } else if (command instanceof AbortMultipartUploadCommand) {
                    abortMultipartUploadStubCallCount++;
                    abortMultipartUploadArgs.push(command.input);
                    return testData.abortMultipartUploadStub_positive_response;
                } else if (command instanceof ListPartsCommand) {
                    listPartsStubCallCount++;
                    listPartsArgs.push(command.input);
                    return testData.listPartsStub_positive_response;
                }
            });

            return s3Module
                .copyObjectMultipart(
                    testData.partial_request_options,
                    testData.request_context
                )
                .then(() => {
                    throw new Error(
                        "s3Module resolved when an error should have been rejected"
                    );
                })
                .catch((err) => {
                    should(loggerErrorSpy.calledOnce).equal(true);
                    should(loggerErrorSpy.args[0][0]).eql({
                        msg: "multipart copy failed to initiate",
                        context: "request_context",
                        error: "test_error",
                    });
                    should(uploadPartCopyStubCallCount).equal(0);
                    should(completeMultipartUploadStubCallCount).equal(0);
                    should(abortMultipartUploadStubCallCount).equal(0);
                    should(listPartsStubCallCount).equal(0);
                    should(err).eql("test_error");
                });
        });

        it("Should call abortMultipartCopy upon error from uploadPartCopy error and succeed", function () {
            sendStub.callsFake((command, options) => {
                if (command instanceof CreateMultipartUploadCommand) {
                    createMultipartUploadStubCallCount++;
                    createMultipartUploadArgs.push(command.input);
                    return testData.createMultipartUploadStub_positive_response;
                } else if (command instanceof UploadPartCopyCommand) {
                    uploadPartCopyStubCallCount++;
                    uploadPartCopyArgs.push(command.input);
                    return testData.all_stubs_error_response;
                } else if (command instanceof CompleteMultipartUploadCommand) {
                    completeMultipartUploadStubCallCount++;
                    completeMultipartUploadArgs.push(command.input);
                    return testData.completeMultipartUploadStub_positive_response;
                } else if (command instanceof AbortMultipartUploadCommand) {
                    abortMultipartUploadStubCallCount++;
                    abortMultipartUploadArgs.push(command.input);
                    return testData.abortMultipartUploadStub_positive_response;
                } else if (command instanceof ListPartsCommand) {
                    listPartsStubCallCount++;
                    listPartsArgs.push(command.input);
                    return testData.listPartsStub_positive_response;
                }
            });

            return s3Module
                .copyObjectMultipart(
                    testData.full_request_options,
                    testData.request_context
                )
                .then(() => {
                    throw new Error(
                        "s3Module resolved when an error should have been rejected"
                    );
                })
                .catch((err) => {
                    should(loggerInfoSpy.callCount).equal(2);
                    should(loggerInfoSpy.args[1][0]).eql({
                        msg:
                            "multipart copy aborted successfully: " +
                            JSON.stringify({ Parts: [] }),
                        context: "request_context",
                    });
                    should(loggerErrorSpy.calledTwice).equal(true);
                    should(loggerErrorSpy.args[0][0]).eql({
                        msg: 'CopyPart 1 Failed: "test_error"',
                        error: "test_error",
                    });
                    should(loggerErrorSpy.args[1][0]).eql({
                        msg: 'CopyPart 2 Failed: "test_error"',
                        error: "test_error",
                    });
                    should(createMultipartUploadStubCallCount).equal(1);
                    should(createMultipartUploadArgs[0]).eql(
                        testData.expected_createMultipartUpload_args
                    );
                    should(uploadPartCopyStubCallCount).equal(2);
                    should(uploadPartCopyArgs[0]).eql(
                        testData.expected_uploadPartCopy_firstCallArgs
                    );
                    should(uploadPartCopyArgs[1]).eql(
                        testData.expected_uploadPartCopy_secondCallArgs
                    );
                    should(abortMultipartUploadStubCallCount).equal(1);
                    should(abortMultipartUploadArgs[0]).eql(
                        testData.expected_abortMultipartUploadStub_args
                    );
                    should(listPartsStubCallCount).equal(1);
                    should(listPartsArgs[0]).eql(
                        testData.expected_abortMultipartUploadStub_args
                    );
                    should(JSON.stringify(err)).eql(
                        JSON.stringify(
                            testData.expected_abort_rejection_response
                        )
                    );
                });
        });

        it("Should call abortMultipartCopy upon error from completeMultipartUpload", function () {
            sendStub.callsFake((command, options) => {
                if (command instanceof CreateMultipartUploadCommand) {
                    createMultipartUploadStubCallCount++;
                    createMultipartUploadArgs.push(command.input);
                    return testData.createMultipartUploadStub_positive_response;
                } else if (command instanceof UploadPartCopyCommand) {
                    uploadPartCopyStubCallCount++;
                    uploadPartCopyArgs.push(command.input);
                    return testData.uploadPartCopyStub_positive_response;
                } else if (command instanceof CompleteMultipartUploadCommand) {
                    completeMultipartUploadStubCallCount++;
                    completeMultipartUploadArgs.push(command.input);
                    return testData.all_stubs_error_response;
                } else if (command instanceof AbortMultipartUploadCommand) {
                    abortMultipartUploadStubCallCount++;
                    abortMultipartUploadArgs.push(command.input);
                    return testData.abortMultipartUploadStub_positive_response;
                } else if (command instanceof ListPartsCommand) {
                    listPartsStubCallCount++;
                    listPartsArgs.push(command.input);
                    return testData.listPartsStub_positive_response;
                }
            });

            return s3Module
                .copyObjectMultipart(
                    testData.full_request_options,
                    testData.request_context
                )
                .then(() => {
                    throw new Error(
                        "s3Module resolved when an error should have been rejected"
                    );
                })
                .catch((err) => {
                    should(loggerInfoSpy.callCount).equal(5);
                    should(loggerInfoSpy.args[4][0]).eql({
                        msg:
                            "multipart copy aborted successfully: " +
                            JSON.stringify({ Parts: [] }),
                        context: "request_context",
                    });
                    should(loggerErrorSpy.calledOnce).equal(true);
                    should(loggerErrorSpy.args[0][0]).eql({
                        msg: "Multipart upload failed",
                        context: "request_context",
                        error: "test_error",
                    });
                    should(createMultipartUploadStubCallCount).equal(1);
                    should(createMultipartUploadArgs[0]).eql(
                        testData.expected_createMultipartUpload_args
                    );
                    should(uploadPartCopyStubCallCount).equal(2);
                    should(uploadPartCopyArgs[0]).eql(
                        testData.expected_uploadPartCopy_firstCallArgs
                    );
                    should(uploadPartCopyArgs[1]).eql(
                        testData.expected_uploadPartCopy_secondCallArgs
                    );
                    should(completeMultipartUploadStubCallCount).equal(1);
                    should(completeMultipartUploadArgs[0]).eql(
                        testData.expected_completeMultipartUploadStub_args
                    );
                    should(abortMultipartUploadStubCallCount).equal(1);
                    should(abortMultipartUploadArgs[0]).eql(
                        testData.expected_abortMultipartUploadStub_args
                    );
                    should(listPartsStubCallCount).equal(1);
                    should(listPartsArgs[0]).eql(
                        testData.expected_abortMultipartUploadStub_args
                    );
                    should(JSON.stringify(err)).eql(
                        JSON.stringify(
                            testData.expected_abort_rejection_response
                        )
                    );
                });
        });

        it("Should call abortMultipartCopy upon error from completeMultipartUpload and a list of parts returned from listParts", async function () {
            sendStub.callsFake((command, options) => {
                if (command instanceof CreateMultipartUploadCommand) {
                    createMultipartUploadStubCallCount++;
                    createMultipartUploadArgs.push(command.input);
                    return testData.createMultipartUploadStub_positive_response;
                } else if (command instanceof UploadPartCopyCommand) {
                    uploadPartCopyStubCallCount++;
                    uploadPartCopyArgs.push(command.input);
                    return testData.uploadPartCopyStub_positive_response;
                } else if (command instanceof CompleteMultipartUploadCommand) {
                    completeMultipartUploadStubCallCount++;
                    completeMultipartUploadArgs.push(command.input);
                    return testData.all_stubs_error_response;
                } else if (command instanceof AbortMultipartUploadCommand) {
                    abortMultipartUploadStubCallCount++;
                    abortMultipartUploadArgs.push(command.input);
                    return testData.abortMultipartUploadStub_positive_response;
                } else if (command instanceof ListPartsCommand) {
                    listPartsStubCallCount++;
                    listPartsArgs.push(command.input);
                    return testData.listPartsStub_negative_response;
                }
            });

            let expected_abortMultipartUpload_error = new Error(
                "Abort procedure passed but copy parts were not removed"
            );
            expected_abortMultipartUpload_error.details = {
                Parts: ["part 1", "part 2"],
            };
            const uploadPartCopyStubResponse =
                await testData.uploadPartCopyStub_positive_response;
            const error = new Error(
                "Abort procedure passed but copy parts were not removed"
            );
            error.details = { Parts: ["part 1", "part 2"] };

            return s3Module
                .copyObjectMultipart(
                    testData.full_request_options,
                    testData.request_context
                )
                .then(() => {
                    throw new Error(
                        "s3Module resolved when an error should have been rejected"
                    );
                })
                .catch((err) => {
                    should(loggerInfoSpy.callCount).equal(4);
                    should(loggerInfoSpy.args[3][0]).eql({
                        msg:
                            "copied all parts successfully: " +
                            JSON.stringify([
                                uploadPartCopyStubResponse,
                                uploadPartCopyStubResponse,
                            ]),
                        context: "request_context",
                    });
                    should(loggerErrorSpy.calledTwice).equal(true);
                    should(loggerErrorSpy.args[0][0]).eql({
                        msg: "Multipart upload failed",
                        context: "request_context",
                        error: "test_error",
                    });
                    should(JSON.stringify(loggerErrorSpy.args[1][0])).eql(
                        JSON.stringify({
                            msg: "abort multipart copy failed, copy parts were not removed",
                            context: "request_context",
                            error,
                        })
                    );
                    should(createMultipartUploadStubCallCount).equal(1);
                    should(createMultipartUploadArgs[0]).eql(
                        testData.expected_createMultipartUpload_args
                    );
                    should(uploadPartCopyStubCallCount).equal(2);
                    should(uploadPartCopyArgs[0]).eql(
                        testData.expected_uploadPartCopy_firstCallArgs
                    );
                    should(uploadPartCopyArgs[1]).eql(
                        testData.expected_uploadPartCopy_secondCallArgs
                    );
                    should(completeMultipartUploadStubCallCount).equal(1);
                    should(completeMultipartUploadArgs[0]).eql(
                        testData.expected_completeMultipartUploadStub_args
                    );
                    should(abortMultipartUploadStubCallCount).equal(1);
                    should(abortMultipartUploadArgs[0]).eql(
                        testData.expected_abortMultipartUploadStub_args
                    );
                    should(listPartsStubCallCount).equal(1);
                    should(listPartsArgs[0]).eql(
                        testData.expected_abortMultipartUploadStub_args
                    );
                    should(JSON.stringify(err)).eql(
                        JSON.stringify(expected_abortMultipartUpload_error)
                    );
                });
        });

        it("Should call abortMultipartCopy upon error from completeMultipartUpload and fail due to abortMultipartCopy error", async function () {
            sendStub.callsFake((command, options) => {
                if (command instanceof CreateMultipartUploadCommand) {
                    createMultipartUploadStubCallCount++;
                    createMultipartUploadArgs.push(command.input);
                    return testData.createMultipartUploadStub_positive_response;
                } else if (command instanceof UploadPartCopyCommand) {
                    uploadPartCopyStubCallCount++;
                    uploadPartCopyArgs.push(command.input);
                    return testData.uploadPartCopyStub_positive_response;
                } else if (command instanceof CompleteMultipartUploadCommand) {
                    completeMultipartUploadStubCallCount++;
                    completeMultipartUploadArgs.push(command.input);
                    return testData.all_stubs_error_response;
                } else if (command instanceof AbortMultipartUploadCommand) {
                    abortMultipartUploadStubCallCount++;
                    abortMultipartUploadArgs.push(command.input);
                    return testData.all_stubs_error_response;
                } else if (command instanceof ListPartsCommand) {
                    listPartsStubCallCount++;
                    listPartsArgs.push(command.input);
                    return testData.listPartsStub_positive_response;
                }
            });

            const uploadPartCopyStubResponse =
                await testData.uploadPartCopyStub_positive_response;

            return s3Module
                .copyObjectMultipart(
                    testData.full_request_options,
                    testData.request_context
                )
                .then(() => {
                    throw new Error(
                        "s3Module resolved when an error should have been rejected"
                    );
                })
                .catch((err) => {
                    should(loggerInfoSpy.callCount).equal(4);
                    should(loggerInfoSpy.args[3][0]).eql({
                        msg:
                            "copied all parts successfully: " +
                            JSON.stringify([
                                uploadPartCopyStubResponse,
                                uploadPartCopyStubResponse,
                            ]),
                        context: "request_context",
                    });
                    should(loggerErrorSpy.calledTwice).equal(true);
                    should(loggerErrorSpy.args[0][0]).eql({
                        msg: "Multipart upload failed",
                        context: "request_context",
                        error: "test_error",
                    });
                    should(loggerErrorSpy.args[1][0]).eql({
                        msg: "abort multipart copy failed",
                        context: "request_context",
                        error: "test_error",
                    });
                    should(createMultipartUploadStubCallCount).equal(1);
                    should(createMultipartUploadArgs[0]).eql(
                        testData.expected_createMultipartUpload_args
                    );
                    should(uploadPartCopyStubCallCount).equal(2);
                    should(uploadPartCopyArgs[0]).eql(
                        testData.expected_uploadPartCopy_firstCallArgs
                    );
                    should(uploadPartCopyArgs[1]).eql(
                        testData.expected_uploadPartCopy_secondCallArgs
                    );
                    should(completeMultipartUploadStubCallCount).equal(1);
                    should(completeMultipartUploadArgs[0]).eql(
                        testData.expected_completeMultipartUploadStub_args
                    );
                    should(abortMultipartUploadStubCallCount).equal(1);
                    should(abortMultipartUploadArgs[0]).eql(
                        testData.expected_abortMultipartUploadStub_args
                    );
                    should(err).equal("test_error");
                });
        });

        it("Should call abortMultipartCopy upon error from completeMultipartUpload and fail due to listParts error", async function () {
            sendStub.callsFake((command, options) => {
                if (command instanceof CreateMultipartUploadCommand) {
                    createMultipartUploadStubCallCount++;
                    createMultipartUploadArgs.push(command.input);
                    return testData.createMultipartUploadStub_positive_response;
                } else if (command instanceof UploadPartCopyCommand) {
                    uploadPartCopyStubCallCount++;
                    uploadPartCopyArgs.push(command.input);
                    return testData.uploadPartCopyStub_positive_response;
                } else if (command instanceof CompleteMultipartUploadCommand) {
                    completeMultipartUploadStubCallCount++;
                    completeMultipartUploadArgs.push(command.input);
                    return testData.all_stubs_error_response;
                } else if (command instanceof AbortMultipartUploadCommand) {
                    abortMultipartUploadStubCallCount++;
                    abortMultipartUploadArgs.push(command.input);
                    return testData.abortMultipartUploadStub_positive_response;
                } else if (command instanceof ListPartsCommand) {
                    listPartsStubCallCount++;
                    listPartsArgs.push(command.input);
                    return testData.all_stubs_error_response;
                }
            });

            const uploadPartCopyStubResponse =
                await testData.uploadPartCopyStub_positive_response;

            return s3Module
                .copyObjectMultipart(
                    testData.full_request_options,
                    testData.request_context
                )
                .then(() => {
                    throw new Error(
                        "s3Module resolved when an error should have been rejected"
                    );
                })
                .catch((err) => {
                    should(loggerInfoSpy.callCount).equal(4);
                    should(loggerInfoSpy.args[3][0]).eql({
                        msg:
                            "copied all parts successfully: " +
                            JSON.stringify([
                                uploadPartCopyStubResponse,
                                uploadPartCopyStubResponse,
                            ]),
                        context: "request_context",
                    });
                    should(loggerErrorSpy.calledTwice).equal(true);
                    should(loggerErrorSpy.args[0][0]).eql({
                        msg: "Multipart upload failed",
                        context: "request_context",
                        error: "test_error",
                    });
                    should(loggerErrorSpy.args[1][0]).eql({
                        msg: "abort multipart copy failed",
                        context: "request_context",
                        error: "test_error",
                    });
                    should(createMultipartUploadStubCallCount).equal(1);
                    should(createMultipartUploadArgs[0]).eql(
                        testData.expected_createMultipartUpload_args
                    );
                    should(uploadPartCopyStubCallCount).equal(2);
                    should(uploadPartCopyArgs[0]).eql(
                        testData.expected_uploadPartCopy_firstCallArgs
                    );
                    should(uploadPartCopyArgs[1]).eql(
                        testData.expected_uploadPartCopy_secondCallArgs
                    );
                    should(completeMultipartUploadStubCallCount).equal(1);
                    should(completeMultipartUploadArgs[0]).eql(
                        testData.expected_completeMultipartUploadStub_args
                    );
                    should(abortMultipartUploadStubCallCount).equal(1);
                    should(abortMultipartUploadArgs[0]).eql(
                        testData.expected_abortMultipartUploadStub_args
                    );
                    should(err).equal("test_error");
                });
        });
    });
});
