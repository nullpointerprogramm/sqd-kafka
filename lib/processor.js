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
exports.processor = exports.CONTRACT_DEPLOYED_AT = exports.CONTRACT_ADDRESS = void 0;
const util_internal_1 = require("@subsquid/util-internal");
const evm_processor_1 = require("@subsquid/evm-processor");
const erc20 = __importStar(require("./abi/erc20"));
// Set at .env or replace with a ERC20 contract address
exports.CONTRACT_ADDRESS = (0, util_internal_1.assertNotNull)(process.env.CONTRACT_ADDRESS);
exports.CONTRACT_DEPLOYED_AT = parseInt((0, util_internal_1.assertNotNull)(process.env.CONTRACT_DEPLOYED_AT));
exports.processor = new evm_processor_1.EvmBatchProcessor()
    // Lookup archive by the network name in Subsquid registry
    // See https://docs.subsquid.io/evm-indexing/supported-networks/
    .setGateway('https://v2.archive.subsquid.io/network/ethereum-mainnet')
    // Chain RPC endpoint is required for
    //  - indexing unfinalized blocks https://docs.subsquid.io/basics/unfinalized-blocks/
    //  - querying the contract state https://docs.subsquid.io/evm-indexing/query-state/
    .setRpcEndpoint({
    // Set the URL via .env for local runs or via secrets when deploying to Subsquid Cloud
    // https://docs.subsquid.io/deploy-squid/env-variables/
    url: (0, util_internal_1.assertNotNull)(process.env.RPC_ENDPOINT),
    // More RPC connection options at https://docs.subsquid.io/evm-indexing/configuration/initialization/#set-data-source
    rateLimit: 10
})
    .setFinalityConfirmation(75)
    .setFields({
    log: {
        topics: true,
        data: true,
    },
    transaction: {
        hash: true,
    },
})
    .addLog({
    address: [exports.CONTRACT_ADDRESS],
    topic0: [erc20.events.Transfer.topic],
    transaction: true,
})
    .setBlockRange({
    from: exports.CONTRACT_DEPLOYED_AT
});
//# sourceMappingURL=processor.js.map