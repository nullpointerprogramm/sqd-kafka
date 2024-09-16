"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
const erc20 = __importStar(require("./abi/erc20"));
const processor_1 = require("./processor");
const kafka_store_1 = require("./kafka-store");
function bigIntReplacer(_key, value) {
    return typeof value === "bigint" ? value.toString() : value;
}
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}
const kafkaConnector = new kafka_store_1.KafkaDatabase({
    //   brokers: ["pkc-vzj95.eu-central-2.aws.confluent.cloud:9092"],
    brokers: ["localhost:9092", "localhost:9093", "localhost:9094"],
    //   ssl: true,
    //   sasl: {
    //     mechanism: "plain",
    //     username: "KEUVHTB77Y6MQSI4",
    //     password:
    //       "BMsM9qYXNMvJRPYY4J84zWPLsKMqB9RcfO46zLJe7R8dqhegLyzl/BWdExfLWJ3s",
    //   },
    //   clientId: "sqd-kafka",
    //   logLevel: logLevel.DEBUG,
});
processor_1.processor.run(kafkaConnector, async (ctx) => {
    let transfersData = [];
    for (let block of ctx.blocks) {
        for (let log of block.logs) {
            if (log.topics[0] !== erc20.events.Transfer.topic)
                continue;
            let event = erc20.events.Transfer.decode(log);
            transfersData.push({
                id: log.id,
                blockNumber: block.header.height,
                timestamp: new Date(block.header.timestamp),
                txHash: log.transaction?.hash || "0x",
                from: event.from.toLowerCase(),
                to: event.to.toLowerCase(),
                amount: event.value,
            });
        }
    }
    // Need divide on chunks as kafka connect accept message more than 1 mb at once
    const chunkedMessages = chunkArray(transfersData.map((data) => {
        return { key: data.id, value: JSON.stringify(data, bigIntReplacer) };
    }), 1000);
    console.log("Chunks: " + chunkedMessages.length);
    for (const messages of chunkedMessages) {
        await ctx.store.send("topic_0", messages);
    }
});
//# sourceMappingURL=main.js.map