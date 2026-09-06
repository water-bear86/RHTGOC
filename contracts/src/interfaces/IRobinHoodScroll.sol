// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

interface IRobinHoodScroll {
    struct Checkpoint {
        uint256 version;
        bytes32 stateRoot;
        uint256 timestamp;
    }

    struct CheckpointInput {
        uint256 tokenId;
        uint256 version;
        bytes32 stateRoot;
        uint256 timestamp;
        bytes32[] achievementIds;
        bytes32[] fineryIds;
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    event ScrollMinted(uint256 indexed tokenId, address indexed owner, uint256 robinPaid);

    event ScrollPaymentSplit(
        uint256 indexed tokenId, address indexed buyer, uint256 totalPaid, uint256 upkeepAmount, uint256 burnedAmount
    );

    event StateCheckpointed(
        uint256 indexed tokenId, uint256 indexed version, bytes32 indexed stateRoot, uint256 timestamp
    );

    event AchievementRecorded(uint256 indexed tokenId, bytes32 indexed achievementId, uint256 timestamp);
    event FineryUnlocked(uint256 indexed tokenId, bytes32 indexed fineryId, uint256 timestamp);

    event WalletMigrated(
        uint256 indexed tokenId, address indexed previousOwner, address indexed newOwner, uint256 nonce, bool recovery
    );

    event MintPriceUpdated(uint256 previousPrice, uint256 newPrice);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event BaseMetadataURIUpdated(string previousURI, string newURI);

    function mint() external returns (uint256 tokenId);
    function scrollOf(address player) external view returns (uint256 tokenId);
    function hasScroll(address player) external view returns (bool);
    function hasEverHeldScroll(address player) external view returns (bool);
    function ownerOf(uint256 tokenId) external view returns (address);
    function latestCheckpoint(uint256 tokenId) external view returns (Checkpoint memory);
    function verifyCheckpoint(uint256 tokenId, uint256 version, bytes32 stateRoot) external view returns (bool);
    function currentTokenURI(uint256 tokenId) external view returns (string memory);

    function submitCheckpoint(CheckpointInput calldata input) external;
    function submitCheckpoints(CheckpointInput[] calldata inputs) external;
    function checkpointDigest(CheckpointInput calldata input) external view returns (bytes32);

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
}
