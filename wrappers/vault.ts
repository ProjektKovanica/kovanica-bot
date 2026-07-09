import { Contract, ContractProvider, Sender, Address, Cell, contractAddress, beginCell } from "@ton/core";

export class JettonizedVault implements Contract {
    constructor(
        readonly address: Address,
        readonly init?: { code: Cell; data: Cell }
    ) {}

    static createFromAddress(address: Address) {
        return new JettonizedVault(address);
    }

    static createFromConfig(config: any, code: Cell, workchain = 0) {
        const data = beginCell()
            .storeAddress(config.owner)
            .storeAddress(config.jettonMaster)
            .endCell();
        const init = { code, data };
        return new JettonizedVault(contractAddress(workchain, init), init);
    }

    async sendDeploy(provider: ContractProvider, via: Sender, value: bigint) {
        await provider.internal(via, {
            value,
            sendMode: 1,
            body: beginCell().storeUint(0, 32).storeUint(0, 64).endCell(),
        });
    }

    async sendWithdraw(provider: ContractProvider, via: Sender, to: Address, amount: bigint) {
        const body = beginCell()
            .storeUint(0, 32)
            .storeUint(0, 64)
            .storeStringTail("withdraw")
            .storeAddress(to)
            .storeCoins(amount)
            .endCell();

        await provider.internal(via, {
            value: 50000000n,
            sendMode: 1,
            body,
        });
    }

    async getBalance(provider: ContractProvider) {
        const result = await provider.get("getBalance", []);
        return result.stack.readBigNumber();
    }
}
