import {
  FinalDatabase,
  HashAndHeight,
  FinalTxInfo,
} from "@subsquid/util-internal-processor-tools";
import assert from "assert";
import {
  Admin,
  Consumer,
  Kafka,
  KafkaConfig,
  Message,
  Producer,
  Transaction,
} from "kafkajs";

const RACE_MSG =
  "status table was updated by foreign process, make sure no other processor is running";

export class KafkaStore {
  constructor(private readonly kafkaProducer: Transaction) {}

  public async send(topicName: string, messages: Message[]) {
    await this.kafkaProducer.send({
      topic: topicName,
      messages: messages,
    });
  }
}

export class KafkaDatabase implements FinalDatabase<KafkaStore> {
  private readonly kafkaClient: Kafka;
  private readonly kafkaProducer: Producer;
  private readonly kafkaConsumer: Consumer;
  private readonly kafkaAdmin: Admin;

  private localStateStore = {
    hash: "0x",
    height: 0,
    nonce: 0,
  };

  constructor(
    private readonly kafkaConfig: KafkaConfig,
    private readonly stateTopicName: string = "__sqd_state"
  ) {
    this.kafkaClient = new Kafka(kafkaConfig);
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

  public async connect(): Promise<HashAndHeight> {
    await this.kafkaProducer.connect();

    await this.loadState();

    console.log(this.localStateStore);
    return { ...this.localStateStore };
  }

  public async transact(
    info: FinalTxInfo,
    cb: (store: KafkaStore) => Promise<void>
  ): Promise<void> {
    let state = this.localStateStore;
    let { prevHead: prev, nextHead: next } = info;

    assert(state.hash === info.prevHead.hash, RACE_MSG);
    assert(state.height === prev.height);
    assert(prev.height < next.height);
    assert(prev.hash != next.hash);

    await this.performUpdates(cb);

    await this.updateState(state.nonce, next);
  }

  private async performUpdates(
    cb: (store: KafkaStore) => Promise<void>
  ): Promise<void> {
    const transaction = await this.kafkaProducer.transaction();
    let store = new KafkaStore(transaction);
    try {
      await cb(store);
      await transaction.commit();
    } catch (e) {
      await transaction.abort();
      throw e;
    }
  }

  private async updateState(nonce: number, next: HashAndHeight): Promise<void> {
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

  private async loadState() {
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

    const offsetObject = (
      await this.kafkaAdmin.fetchTopicOffsets(this.stateTopicName)
    )[0];

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
      } else {
        await new Promise<void>((resolveTimeout) => {
          setTimeout(() => {
            resolveTimeout();
          }, 1000);
        });
      }
    }
  }
}
