import * as erc20 from "./abi/erc20";
import { processor } from "./processor";
import { KafkaDatabase } from "./kafka-store";
import { assertNotNull } from "@subsquid/evm-processor";

interface TransferEventData {
  id: string;
  blockNumber: number;
  timestamp: Date;
  txHash: string;
  from: string;
  to: string;
  amount: bigint;
}

function bigIntReplacer(_key: string, value: any): any {
  return typeof value === "bigint" ? value.toString() : value;
}

function chunkArray<T>(array: Array<T>, chunkSize: number): Array<T>[] {
  const chunks = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

const BROKERS = assertNotNull(process.env.KAFKA_BROKERS);

const kafkaConnector = new KafkaDatabase({
  brokers: BROKERS.split(","),
});

processor.run(kafkaConnector, async (ctx) => {
  let transfersData: TransferEventData[] = [];

  for (let block of ctx.blocks) {
    for (let log of block.logs) {
      if (log.topics[0] !== erc20.events.Transfer.topic) continue;

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

  // Need divide on chunks as kafka connect accept message no more than 1 mb at once
  const chunkedMessages = chunkArray(
    transfersData.map((data) => {
      return { key: data.id, value: JSON.stringify(data, bigIntReplacer) };
    }),
    1000
  );

  console.log("Chunks: " + chunkedMessages.length);
  for (const messages of chunkedMessages) {
    await ctx.store.send("topic_0", messages);
  }
});
