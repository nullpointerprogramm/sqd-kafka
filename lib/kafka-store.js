"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KafkaDatabase = exports.KafkaStore = void 0;
const assert_1 = __importDefault(require("assert"));
const kafkajs_1 = require("kafkajs");
const RACE_MSG = "status table was updated by foreign process, make sure no other processor is running";
class KafkaStore {
    constructor(kafkaProducer) {
        this.kafkaProducer = kafkaProducer;
    }
    async send(topicName, messages) {
        await this.kafkaProducer.send({
            topic: topicName,
            messages: messages,
        });
    }
}
exports.KafkaStore = KafkaStore;
class KafkaDatabase {
    constructor(kafkaConfig, stateTopicName = "__sqd_state") {
        this.kafkaConfig = kafkaConfig;
        this.stateTopicName = stateTopicName;
        this.localStateStore = {
            hash: "0x",
            height: 0,
            nonce: 0,
        };
        this.kafkaClient = new kafkajs_1.Kafka(kafkaConfig);
        this.kafkaProducer = this.kafkaClient.producer({
            allowAutoTopicCreation: true,
            transactionalId: kafkaConfig.clientId || "sqd-client" + "-transactional",
            maxInFlightRequests: 1,
            idempotent: true,
        });
        this.kafkaConsumer = this.kafkaClient.consumer({
            groupId: kafkaConfig.clientId || "sqd-client",
            allowAutoTopicCreation: true,
        });
        this.kafkaAdmin = this.kafkaClient.admin();
    }
    async connect() {
        await this.kafkaProducer.connect();
        await this.loadState();
        console.log(this.localStateStore);
        return { ...this.localStateStore };
    }
    async transact(info, cb) {
        let state = this.localStateStore;
        let { prevHead: prev, nextHead: next } = info;
        (0, assert_1.default)(state.hash === info.prevHead.hash, RACE_MSG);
        (0, assert_1.default)(state.height === prev.height);
        (0, assert_1.default)(prev.height < next.height);
        (0, assert_1.default)(prev.hash != next.hash);
        await this.performUpdates(cb);
        await this.updateState(state.nonce, next);
    }
    async performUpdates(cb) {
        const transaction = await this.kafkaProducer.transaction();
        let store = new KafkaStore(transaction);
        try {
            await cb(store);
            await transaction.commit();
        }
        catch (e) {
            await transaction.abort();
            throw e;
        }
    }
    async updateState(nonce, next) {
        this.localStateStore.hash = next.hash;
        this.localStateStore.height = next.height;
        this.localStateStore.nonce = nonce + 1;
        this.kafkaProducer.send({
            topic: this.stateTopicName,
            messages: [
                {
                    key: this.kafkaConfig.clientId || "sqd-client",
                    value: JSON.stringify(this.localStateStore),
                },
            ],
        });
    }
    async loadState() {
        await this.kafkaAdmin.connect();
        await this.kafkaConsumer.connect();
        if (!(await this.kafkaAdmin.listTopics()).includes(this.stateTopicName)) {
            await this.kafkaAdmin.createTopics({
                topics: [
                    {
                        topic: this.stateTopicName,
                    },
                ],
            });
        }
        const offsetObject = (await this.kafkaAdmin.fetchTopicOffsets(this.stateTopicName))[0];
        if (Number(offsetObject.high) === 0) {
            return;
        }
        const offset = (Number(offsetObject.high) - 1).toString();
        await this.kafkaAdmin.disconnect();
        await this.kafkaConsumer.subscribe({ topic: this.stateTopicName });
        let stateReadCompleted = false;
        await this.kafkaConsumer.run({
            eachMessage: async (bufferMessage) => {
                const payload = bufferMessage.message;
                if (payload.value) {
                    this.localStateStore = JSON.parse(payload.value.toString());
                }
                if (payload.offset === offset) {
                    stateReadCompleted = true;
                }
            },
        });
        this.kafkaConsumer.seek({
            topic: this.stateTopicName,
            partition: 0,
            offset,
        });
        while (true) {
            if (stateReadCompleted) {
                await this.kafkaConsumer.disconnect();
                break;
            }
            else {
                await new Promise((resolveTimeout) => {
                    setTimeout(() => {
                        resolveTimeout();
                    }, 1000);
                });
            }
        }
    }
}
exports.KafkaDatabase = KafkaDatabase;
//# sourceMappingURL=kafka-store.js.map