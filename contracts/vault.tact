contract JettonizedVault {
    jettonMaster: Address;
    owner: Address;
    
    init(owner: Address, jettonMaster: Address) {
        self.owner = owner;
        self.jettonMaster = jettonMaster;
        self.require(self.owner != null, "Owner cannot be null");
        self.require(self.jettonMaster != null, "Jetton master cannot be null");
    }
    
    receive("jetton_notification", (sender: Address, amount: Int, payload: Cell)) {
        // Prihvaća Jetton
    }
    
    receive("withdraw", (to: Address, amount: Int)) {
        self.require(self.owner == sender(), "Only owner can withdraw");
        self.require(amount > 0, "Amount must be positive");
        self.require(amount <= self.balance, "Insufficient balance");
        
        let jettonWallet = contractAddress(JettonWallet, beginCell()
            .storeAddress(to)
            .endCell()
        );
        
        let transferBody = beginCell()
            .storeUint(0xf8a7ea5, 32)
            .storeUint(0, 64)
            .storeCoins(amount * 1000000000)
            .storeAddress(to)
            .storeAddress(myAddress())
            .storeUint(0, 1)
            .storeCoins(0)
            .storeUint(0, 1)
            .endCell();
        
        send(SendParameters {
            to: jettonWallet,
            value: 50000000,
            body: transferBody,
            mode: SendMode.PAY_FEES,
        });
    }
    
    get fun getBalance(): Int {
        return self.balance;
    }
    
    get fun getJettonMaster(): Address {
        return self.jettonMaster;
    }
    
    get fun getOwner(): Address {
        return self.owner;
    }
}
