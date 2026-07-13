import { Interface } from "ethers"
import { describe, expect, it } from "vitest"
import { tokenAccessGateEnabled, verifyTokenChain, verifyTokenConfirmations, verifyTokenTransfer, walletAddressFromIdentities, type TokenPaymentConfig } from "./token-access-service"

const iface = new Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"])
const wallet = "0x1111111111111111111111111111111111111111"
const treasury = "0x2222222222222222222222222222222222222222"
const token = "0x3333333333333333333333333333333333333333"
const payment: TokenPaymentConfig = {
  chainId: 46630,
  chainName: "Robinhood Chain Testnet",
  tokenContract: token,
  treasuryAddress: treasury,
  amountBaseUnits: "6000000",
  amountDisplay: "6.0",
  tokenSymbol: "HOOD",
  tokenDecimals: 6,
  passDays: 30,
  confirmations: 2,
}

function transferLog(from = wallet, to = treasury, value = 6_000_000n) {
  const event = iface.encodeEventLog(iface.getEvent("Transfer")!, [from, to, value])
  return { address: token, topics: event.topics, data: event.data }
}

describe("token access gate", () => {
  it("is off by default and accepts explicit switch values", () => {
    expect(tokenAccessGateEnabled(undefined)).toBe(false)
    expect(tokenAccessGateEnabled("false")).toBe(false)
    expect(tokenAccessGateEnabled("true")).toBe(true)
    expect(tokenAccessGateEnabled("1")).toBe(true)
    expect(tokenAccessGateEnabled("on")).toBe(true)
  })

  it("accepts only a sufficient transfer from the signed-in wallet to the treasury", () => {
    expect(verifyTokenTransfer({ from: wallet, to: token }, { status: 1, logs: [transferLog()] } as never, wallet, payment)).toBe(6_000_000n)
    expect(() => verifyTokenTransfer({ from: wallet, to: token }, { status: 1, logs: [transferLog(wallet, treasury, 5_999_999n)] } as never, wallet, payment)).toThrow("TOKEN_PAYMENT_UNDERPAID")
    expect(() => verifyTokenTransfer({ from: treasury, to: token }, { status: 1, logs: [transferLog()] } as never, wallet, payment)).toThrow("TOKEN_PAYMENT_WRONG_SENDER")
    expect(() => verifyTokenTransfer({ from: wallet, to: treasury }, { status: 1, logs: [transferLog()] } as never, wallet, payment)).toThrow("TOKEN_PAYMENT_WRONG_CONTRACT")
  })

  it("binds payment only to the Web3 identity rather than editable user metadata", () => {
    expect(walletAddressFromIdentities([{ provider: "web3", provider_id: wallet, identity_data: {} }])).toBe(wallet)
    expect(walletAddressFromIdentities([{ provider: "email", provider_id: wallet, identity_data: { address: wallet } }])).toBeNull()
    expect(walletAddressFromIdentities({ address: wallet })).toBeNull()
  })

  it("rejects the wrong Robinhood network and insufficient finality", () => {
    expect(() => verifyTokenChain(4663n, 46630)).toThrow("TOKEN_PAYMENT_WRONG_CHAIN")
    expect(() => verifyTokenConfirmations(100, 100, 2)).toThrow("TOKEN_PAYMENT_NEEDS_2_CONFIRMATIONS")
    expect(() => verifyTokenConfirmations(101, 100, 2)).not.toThrow()
  })
})
