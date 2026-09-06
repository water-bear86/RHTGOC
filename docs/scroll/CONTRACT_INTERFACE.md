# RobinHoodScroll contract interface

The deployed contract is non-upgradeable and inherits OpenZeppelin ERC-721, role access control, pausing, EIP-712, and reentrancy protection. The exact generated ABI in `contracts/out/` remains authoritative.

## Read interface

```solidity
function scrollOf(address player) external view returns (uint256);
function ownerOf(uint256 tokenId) public view returns (address);
function latestCheckpoint(uint256 tokenId) external view returns (Checkpoint memory);
function hasScroll(address player) external view returns (bool);
function verifyCheckpoint(uint256 tokenId, uint256 version, bytes32 stateRoot) external view returns (bool);
function currentTokenURI(uint256 tokenId) external view returns (string memory);
function checkpointNonces(uint256 tokenId) external view returns (uint256);
function migrationNonces(uint256 tokenId) external view returns (uint256);
function recoveryNonces(uint256 tokenId) external view returns (uint256);
function mintPrice() external view returns (uint256);
```

`scrollOf` returns zero when the wallet does not currently own a Scroll. Token IDs begin at one.

## Write interface

```solidity
function mint() external returns (uint256 tokenId);
function submitCheckpoint(CheckpointInput calldata input) external;
function submitCheckpoints(CheckpointInput[] calldata inputs) external;
function migrateWallet(
    uint256 tokenId,
    address newOwner,
    uint256 nonce,
    uint256 deadline,
    bytes calldata ownerSignature,
    bytes calldata newOwnerSignature
) external;
function recoverWallet(
    uint256 tokenId,
    address newOwner,
    uint256 nonce,
    uint256 deadline,
    bytes calldata recoverySignature
) external;
function setMintPrice(uint256 newPrice) external;
function setTreasury(address newTreasury) external;
function setBaseMetadataURI(string calldata newBaseURI) external;
function pause() external;
function unpause() external;
```

`CheckpointInput` contains `tokenId`, `version`, `stateRoot`, `timestamp`, the two
sorted `bytes32[]` event arrays, `nonce`, `deadline`, and `signature` in that order.
The signature binds hashes of both arrays. Each input caps achievements and fineries at
64; `submitCheckpoints` caps a cross-player batch at 32. These events are informational
projections of the signed batch and do not create separate storage histories.
The submitting relayer must differ from the recovered checkpoint signer; this remains
enforced even if governance accidentally assigns both roles to one address.

`migrateWallet` is relayer-only and requires EIP-712 consent from both the current owner
and destination, including ERC-1271 contract wallets. This lets operators keep migration
closed until the off-chain event consumer is active. `recoverWallet` is the exceptional
lost-key path and requires a recovery-role signature submitted by a separate relayer.

## Required events

```solidity
event ScrollMinted(uint256 indexed tokenId, address indexed owner, uint256 robinPaid);
event ScrollPaymentSplit(uint256 indexed tokenId, address indexed buyer, uint256 totalPaid, uint256 upkeepAmount, uint256 burnedAmount);
event StateCheckpointed(uint256 indexed tokenId, uint256 indexed version, bytes32 indexed stateRoot, uint256 timestamp);
event AchievementRecorded(uint256 indexed tokenId, bytes32 indexed achievementId, uint256 timestamp);
event FineryUnlocked(uint256 indexed tokenId, bytes32 indexed fineryId, uint256 timestamp);
```

Additional configuration, pause, migration, and role events make administrative changes auditable.

## Role layout

| Role | Holder | Capability |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` / configuration role | `TimelockController` | Price within immutable bounds, treasury, metadata URI, role grant/revoke, unpause. |
| `PAUSER_ROLE` | Emergency multisig | Pause only. |
| `CHECKPOINT_SIGNER_ROLE` | Dedicated EOA signing key | Authorize roots; cannot submit a checkpoint. |
| `RELAYER_ROLE` | Bounded relayer addresses | Submit already-signed checkpoints and migrations. |

The deployer renounces temporary authority after configuring the timelock and roles.
