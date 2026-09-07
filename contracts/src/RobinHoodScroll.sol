// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IRobinHoodScroll} from "./interfaces/IRobinHoodScroll.sol";
import {ITimelockDelay} from "./interfaces/ITimelockDelay.sol";

/// @title RobinHoodScroll
/// @notice Soulbound persistent identity and canonical-state commitment for Sherwood.
/// @dev Detailed state and histories remain offchain. This contract stores only the latest commitment.
contract RobinHoodScroll is ERC721, AccessControl, Pausable, ReentrancyGuard, EIP712, IRobinHoodScroll {
    using SafeERC20 for IERC20;

    bytes32 public constant TIMELOCK_ADMIN_ROLE = keccak256("TIMELOCK_ADMIN_ROLE");
    bytes32 public constant PAUSE_GUARDIAN_ROLE = keccak256("PAUSE_GUARDIAN_ROLE");
    bytes32 public constant CHECKPOINT_SIGNER_ROLE = keccak256("CHECKPOINT_SIGNER_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 public constant RECOVERY_SIGNER_ROLE = keccak256("RECOVERY_SIGNER_ROLE");

    uint256 public constant MAX_CHECKPOINTS_PER_BATCH = 32;
    uint256 public constant MAX_ACHIEVEMENTS_PER_CHECKPOINT = 64;
    uint256 public constant MAX_FINERIES_PER_CHECKPOINT = 64;
    uint256 public constant MIN_TIMELOCK_DELAY = 2 days;
    address public constant VERIFIED_DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    bytes32 public constant CHECKPOINT_TYPEHASH = keccak256(
        "CheckpointAuthorization(uint256 tokenId,address owner,uint256 version,bytes32 stateRoot,uint256 timestamp,bytes32 achievementsHash,bytes32 fineriesHash,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant WALLET_MIGRATION_TYPEHASH = keccak256(
        "WalletMigration(uint256 tokenId,address currentOwner,address newOwner,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant WALLET_RECOVERY_TYPEHASH = keccak256(
        "WalletRecovery(uint256 tokenId,address currentOwner,address newOwner,uint256 nonce,uint256 deadline)"
    );

    IERC20 public immutable robinToken;
    address public immutable burnAddress;
    uint256 public immutable minMintPrice;
    uint256 public immutable maxMintPrice;

    uint256 public mintPrice;
    address public treasury;
    string public baseMetadataURI;

    uint256 private _nextTokenId = 1;
    bool private _migrationInProgress;

    mapping(address player => uint256 tokenId) private _scrolls;
    mapping(address player => bool held) private _everHeldScroll;
    mapping(uint256 tokenId => Checkpoint checkpoint) private _latestCheckpoints;

    mapping(uint256 tokenId => uint256 nonce) public checkpointNonces;
    mapping(uint256 tokenId => uint256 nonce) public migrationNonces;
    mapping(uint256 tokenId => uint256 nonce) public recoveryNonces;
    mapping(bytes32 digest => bool used) public usedAuthorizations;

    error InvalidRobinToken(address token);
    error InvalidBurnAddress(address supplied);
    error InvalidTreasury(address treasury);
    error InvalidTimelock(address timelock);
    error TimelockDelayTooShort(uint256 supplied, uint256 minimum);
    error InvalidRoleAccount(bytes32 role, address account);
    error CheckpointKeySeparationRequired();
    error RecoveryKeySeparationRequired();
    error InvalidPriceBounds(uint256 minimum, uint256 maximum);
    error InvalidMintPrice(uint256 price);
    error OddMintPrice(uint256 price);
    error AlreadyHeldScroll(address wallet);
    error InexactPaymentSplit(uint256 expectedHalf, uint256 treasuryReceived, uint256 burnReceived);
    error Soulbound();
    error UnauthorizedCheckpointSubmitter(address caller);
    error UnauthorizedMigrationSubmitter(address caller);
    error UnauthorizedSigner(address signer, bytes32 requiredRole);
    error InvalidWalletConsent(address wallet);
    error InvalidDestination(address destination);
    error DestinationPreviouslyHeldScroll(address destination);
    error AuthorizationExpired(uint256 deadline, uint256 currentTimestamp);
    error AuthorizationAlreadyUsed(bytes32 digest);
    error InvalidNonce(uint256 expected, uint256 supplied);
    error StaleCheckpointVersion(uint256 currentVersion, uint256 suppliedVersion);
    error InvalidStateRoot();
    error InvalidCheckpointTimestamp(uint256 previousTimestamp, uint256 suppliedTimestamp, uint256 currentTimestamp);
    error EmptyCheckpointBatch();
    error CheckpointBatchTooLarge(uint256 supplied, uint256 maximum);
    error AwardBatchTooLarge(bool achievements, uint256 supplied, uint256 maximum);
    error AwardIdsNotStrictlyIncreasing(bool achievements, uint256 index);
    error EmptyMetadataURI();

    constructor(
        IERC20 robinToken_,
        address burnAddress_,
        address treasury_,
        uint256 initialMintPrice_,
        uint256 minMintPrice_,
        uint256 maxMintPrice_,
        string memory baseMetadataURI_,
        address timelockAdmin_,
        address pauseGuardian_,
        address checkpointSigner_,
        address relayer_,
        address recoverySigner_
    ) ERC721("Sherwood Scroll", "SCROLL") EIP712("RobinHoodScroll", "1") {
        if (
            address(robinToken_) == address(0) || address(robinToken_) == address(1)
                || address(robinToken_).code.length == 0
        ) {
            revert InvalidRobinToken(address(robinToken_));
        }
        if (burnAddress_ != VERIFIED_DEAD_ADDRESS) revert InvalidBurnAddress(burnAddress_);

        robinToken = robinToken_;
        burnAddress = burnAddress_;

        _validateTreasury(treasury_);
        if (timelockAdmin_ == address(0) || timelockAdmin_.code.length == 0) {
            revert InvalidTimelock(timelockAdmin_);
        }
        try ITimelockDelay(timelockAdmin_).getMinDelay() returns (uint256 delay) {
            if (delay < MIN_TIMELOCK_DELAY) revert TimelockDelayTooShort(delay, MIN_TIMELOCK_DELAY);
        } catch {
            revert InvalidTimelock(timelockAdmin_);
        }
        _validateRoleAccount(PAUSE_GUARDIAN_ROLE, pauseGuardian_);
        _validateRoleAccount(CHECKPOINT_SIGNER_ROLE, checkpointSigner_);
        _validateRoleAccount(RELAYER_ROLE, relayer_);
        _validateRoleAccount(RECOVERY_SIGNER_ROLE, recoverySigner_);
        if (checkpointSigner_ == relayer_) revert CheckpointKeySeparationRequired();
        if (recoverySigner_ == relayer_) revert RecoveryKeySeparationRequired();

        if (minMintPrice_ == 0 || minMintPrice_ > maxMintPrice_ || minMintPrice_ % 2 != 0 || maxMintPrice_ % 2 != 0) {
            revert InvalidPriceBounds(minMintPrice_, maxMintPrice_);
        }
        _validateMintPrice(initialMintPrice_, minMintPrice_, maxMintPrice_);
        if (bytes(baseMetadataURI_).length == 0) revert EmptyMetadataURI();

        minMintPrice = minMintPrice_;
        maxMintPrice = maxMintPrice_;
        mintPrice = initialMintPrice_;
        treasury = treasury_;
        baseMetadataURI = baseMetadataURI_;

        _setRoleAdmin(TIMELOCK_ADMIN_ROLE, TIMELOCK_ADMIN_ROLE);
        _setRoleAdmin(PAUSE_GUARDIAN_ROLE, TIMELOCK_ADMIN_ROLE);
        _setRoleAdmin(CHECKPOINT_SIGNER_ROLE, TIMELOCK_ADMIN_ROLE);
        _setRoleAdmin(RELAYER_ROLE, TIMELOCK_ADMIN_ROLE);
        _setRoleAdmin(RECOVERY_SIGNER_ROLE, TIMELOCK_ADMIN_ROLE);

        _grantRole(TIMELOCK_ADMIN_ROLE, timelockAdmin_);
        _grantRole(PAUSE_GUARDIAN_ROLE, pauseGuardian_);
        _grantRole(CHECKPOINT_SIGNER_ROLE, checkpointSigner_);
        _grantRole(RELAYER_ROLE, relayer_);
        _grantRole(RECOVERY_SIGNER_ROLE, recoverySigner_);
    }

    function mint() external nonReentrant whenNotPaused returns (uint256 tokenId) {
        if (_everHeldScroll[msg.sender]) revert AlreadyHeldScroll(msg.sender);

        tokenId = _nextTokenId++;
        uint256 price = mintPrice;
        uint256 half = price / 2;
        uint256 treasuryBefore = robinToken.balanceOf(treasury);
        uint256 burnBefore = robinToken.balanceOf(burnAddress);

        robinToken.safeTransferFrom(msg.sender, treasury, half);
        robinToken.safeTransferFrom(msg.sender, burnAddress, half);

        uint256 treasuryAfter = robinToken.balanceOf(treasury);
        uint256 burnAfter = robinToken.balanceOf(burnAddress);
        uint256 treasuryReceived = treasuryAfter >= treasuryBefore ? treasuryAfter - treasuryBefore : 0;
        uint256 burnReceived = burnAfter >= burnBefore ? burnAfter - burnBefore : 0;
        if (treasuryReceived != half || burnReceived != half) {
            revert InexactPaymentSplit(half, treasuryReceived, burnReceived);
        }

        _everHeldScroll[msg.sender] = true;
        _scrolls[msg.sender] = tokenId;
        _safeMint(msg.sender, tokenId);

        emit ScrollPaymentSplit(tokenId, msg.sender, price, half, half);
        emit ScrollMinted(tokenId, msg.sender, price);
    }

    function scrollOf(address player) external view returns (uint256 tokenId) {
        return _scrolls[player];
    }

    function hasScroll(address player) public view returns (bool) {
        return _scrolls[player] != 0;
    }

    function hasEverHeldScroll(address player) external view returns (bool) {
        return _everHeldScroll[player];
    }

    function ownerOf(uint256 tokenId) public view override(ERC721, IRobinHoodScroll) returns (address) {
        return super.ownerOf(tokenId);
    }

    function latestCheckpoint(uint256 tokenId) external view returns (Checkpoint memory) {
        _requireOwned(tokenId);
        return _latestCheckpoints[tokenId];
    }

    function verifyCheckpoint(uint256 tokenId, uint256 version, bytes32 stateRoot) external view returns (bool) {
        _requireOwned(tokenId);
        Checkpoint storage current = _latestCheckpoints[tokenId];
        return current.version == version && current.stateRoot == stateRoot;
    }

    function currentTokenURI(uint256 tokenId) public view returns (string memory) {
        _requireOwned(tokenId);
        return string.concat(baseMetadataURI, _toDecimalString(tokenId), "/metadata");
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        return currentTokenURI(tokenId);
    }

    function submitCheckpoint(CheckpointInput calldata input) external nonReentrant whenNotPaused {
        _requireCheckpointSubmitter();
        _submitCheckpoint(input);
    }

    function submitCheckpoints(CheckpointInput[] calldata inputs) external nonReentrant whenNotPaused {
        _requireCheckpointSubmitter();
        uint256 length = inputs.length;
        if (length == 0) revert EmptyCheckpointBatch();
        if (length > MAX_CHECKPOINTS_PER_BATCH) revert CheckpointBatchTooLarge(length, MAX_CHECKPOINTS_PER_BATCH);

        for (uint256 i = 0; i < length; ++i) {
            _submitCheckpoint(inputs[i]);
        }
    }

    function checkpointDigest(CheckpointInput calldata input) external view returns (bytes32) {
        return _checkpointDigest(input, ownerOf(input.tokenId));
    }

    function migrateWallet(
        uint256 tokenId,
        address newOwner,
        uint256 nonce,
        uint256 deadline,
        bytes calldata ownerSignature,
        bytes calldata newOwnerSignature
    ) external nonReentrant whenNotPaused {
        address currentOwner = ownerOf(tokenId);
        if (!hasRole(RELAYER_ROLE, msg.sender)) {
            revert UnauthorizedMigrationSubmitter(msg.sender);
        }
        _validateDestination(currentOwner, newOwner);
        _checkDeadline(deadline);

        uint256 expectedNonce = migrationNonces[tokenId];
        if (nonce != expectedNonce) revert InvalidNonce(expectedNonce, nonce);

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(WALLET_MIGRATION_TYPEHASH, tokenId, currentOwner, newOwner, nonce, deadline))
        );
        _requireUnusedAuthorization(digest);
        if (!_isValidWalletSignature(currentOwner, digest, ownerSignature)) {
            revert InvalidWalletConsent(currentOwner);
        }
        if (!_isValidWalletSignature(newOwner, digest, newOwnerSignature)) {
            revert InvalidWalletConsent(newOwner);
        }

        usedAuthorizations[digest] = true;
        migrationNonces[tokenId] = expectedNonce + 1;
        _moveScroll(tokenId, currentOwner, newOwner, nonce, false);
    }

    function recoverWallet(
        uint256 tokenId,
        address newOwner,
        uint256 nonce,
        uint256 deadline,
        bytes calldata recoverySignature
    ) external nonReentrant whenNotPaused onlyRole(RELAYER_ROLE) {
        address currentOwner = ownerOf(tokenId);
        _validateDestination(currentOwner, newOwner);
        _checkDeadline(deadline);

        uint256 expectedNonce = recoveryNonces[tokenId];
        if (nonce != expectedNonce) revert InvalidNonce(expectedNonce, nonce);

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(WALLET_RECOVERY_TYPEHASH, tokenId, currentOwner, newOwner, nonce, deadline))
        );
        _requireUnusedAuthorization(digest);
        address signer = ECDSA.recover(digest, recoverySignature);
        if (!hasRole(RECOVERY_SIGNER_ROLE, signer)) revert UnauthorizedSigner(signer, RECOVERY_SIGNER_ROLE);
        if (signer == msg.sender) revert RecoveryKeySeparationRequired();

        usedAuthorizations[digest] = true;
        recoveryNonces[tokenId] = expectedNonce + 1;
        _moveScroll(tokenId, currentOwner, newOwner, nonce, true);
    }

    function walletMigrationDigest(uint256 tokenId, address newOwner, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(WALLET_MIGRATION_TYPEHASH, tokenId, ownerOf(tokenId), newOwner, nonce, deadline))
        );
    }

    function walletRecoveryDigest(uint256 tokenId, address newOwner, uint256 nonce, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(WALLET_RECOVERY_TYPEHASH, tokenId, ownerOf(tokenId), newOwner, nonce, deadline))
        );
    }

    function pause() external onlyRole(PAUSE_GUARDIAN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(TIMELOCK_ADMIN_ROLE) {
        _unpause();
    }

    function setMintPrice(uint256 newPrice) external onlyRole(TIMELOCK_ADMIN_ROLE) {
        _validateMintPrice(newPrice, minMintPrice, maxMintPrice);
        uint256 previousPrice = mintPrice;
        mintPrice = newPrice;
        emit MintPriceUpdated(previousPrice, newPrice);
    }

    function setTreasury(address newTreasury) external onlyRole(TIMELOCK_ADMIN_ROLE) {
        _validateTreasury(newTreasury);
        address previousTreasury = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(previousTreasury, newTreasury);
    }

    function setBaseMetadataURI(string calldata newBaseMetadataURI) external onlyRole(TIMELOCK_ADMIN_ROLE) {
        if (bytes(newBaseMetadataURI).length == 0) revert EmptyMetadataURI();
        string memory previousURI = baseMetadataURI;
        baseMetadataURI = newBaseMetadataURI;
        emit BaseMetadataURIUpdated(previousURI, newBaseMetadataURI);
    }

    function approve(address, uint256) public pure override {
        revert Soulbound();
    }

    function setApprovalForAll(address, bool) public pure override {
        revert Soulbound();
    }

    function transferFrom(address, address, uint256) public pure override {
        revert Soulbound();
    }

    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert Soulbound();
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC721, AccessControl) returns (bool) {
        return interfaceId == type(IRobinHoodScroll).interfaceId || super.supportsInterface(interfaceId);
    }

    function _submitCheckpoint(CheckpointInput calldata input) private {
        address currentOwner = ownerOf(input.tokenId);
        bytes32 digest = _checkpointDigest(input, currentOwner);
        _requireUnusedAuthorization(digest);
        Checkpoint storage current = _latestCheckpoints[input.tokenId];
        if (input.version <= current.version) revert StaleCheckpointVersion(current.version, input.version);
        if (input.stateRoot == bytes32(0)) revert InvalidStateRoot();
        if (input.timestamp == 0 || input.timestamp < current.timestamp || input.timestamp > block.timestamp) {
            revert InvalidCheckpointTimestamp(current.timestamp, input.timestamp, block.timestamp);
        }
        _checkAwardIds(input.achievementIds, true, MAX_ACHIEVEMENTS_PER_CHECKPOINT);
        _checkAwardIds(input.fineryIds, false, MAX_FINERIES_PER_CHECKPOINT);
        _checkDeadline(input.deadline);

        uint256 expectedNonce = checkpointNonces[input.tokenId];
        if (input.nonce != expectedNonce) revert InvalidNonce(expectedNonce, input.nonce);

        address signer = ECDSA.recover(digest, input.signature);
        if (!hasRole(CHECKPOINT_SIGNER_ROLE, signer)) {
            revert UnauthorizedSigner(signer, CHECKPOINT_SIGNER_ROLE);
        }
        if (signer == msg.sender) revert CheckpointKeySeparationRequired();

        usedAuthorizations[digest] = true;
        checkpointNonces[input.tokenId] = expectedNonce + 1;
        _latestCheckpoints[input.tokenId] =
            Checkpoint({version: input.version, stateRoot: input.stateRoot, timestamp: input.timestamp});

        emit StateCheckpointed(input.tokenId, input.version, input.stateRoot, input.timestamp);
        for (uint256 i = 0; i < input.achievementIds.length; ++i) {
            emit AchievementRecorded(input.tokenId, input.achievementIds[i], input.timestamp);
        }
        for (uint256 i = 0; i < input.fineryIds.length; ++i) {
            emit FineryUnlocked(input.tokenId, input.fineryIds[i], input.timestamp);
        }
    }

    function _checkpointDigest(CheckpointInput calldata input, address currentOwner) private view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    CHECKPOINT_TYPEHASH,
                    input.tokenId,
                    currentOwner,
                    input.version,
                    input.stateRoot,
                    input.timestamp,
                    keccak256(abi.encode(input.achievementIds)),
                    keccak256(abi.encode(input.fineryIds)),
                    input.nonce,
                    input.deadline
                )
            )
        );
    }

    function _moveScroll(uint256 tokenId, address currentOwner, address newOwner, uint256 nonce, bool recovery)
        private
    {
        _scrolls[currentOwner] = 0;
        _scrolls[newOwner] = tokenId;
        _everHeldScroll[newOwner] = true;

        _migrationInProgress = true;
        _update(newOwner, tokenId, address(0));
        _migrationInProgress = false;

        emit WalletMigrated(tokenId, currentOwner, newOwner, nonce, recovery);
    }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        if (from != address(0) && !_migrationInProgress) revert Soulbound();
        return super._update(to, tokenId, auth);
    }

    function _requireUnusedAuthorization(bytes32 digest) private view {
        if (usedAuthorizations[digest]) revert AuthorizationAlreadyUsed(digest);
    }

    function _isValidWalletSignature(address signer, bytes32 digest, bytes calldata signature)
        private
        view
        returns (bool)
    {
        if (signer.code.length == 0) {
            (address recovered, ECDSA.RecoverError recoverError,) = ECDSA.tryRecover(digest, signature);
            return recoverError == ECDSA.RecoverError.NoError && recovered == signer;
        }

        // ERC-1271 intentionally requires a bounded staticcall to the wallet contract.
        (bool success, bytes memory result) =
            signer.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
        // The length guard makes taking the first four return bytes safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        return success && result.length >= 32 && bytes4(result) == IERC1271.isValidSignature.selector;
    }

    function _requireCheckpointSubmitter() private view {
        if (!hasRole(RELAYER_ROLE, msg.sender)) {
            revert UnauthorizedCheckpointSubmitter(msg.sender);
        }
    }

    function _validateTreasury(address candidate) private view {
        if (
            candidate == address(0) || candidate == address(1) || candidate == burnAddress
                || candidate == address(robinToken) || candidate == address(this)
        ) {
            revert InvalidTreasury(candidate);
        }
    }

    function _validateRoleAccount(bytes32 role, address account) private view {
        if (
            account == address(0) || account == address(1) || account == burnAddress || account == address(robinToken)
                || account == address(this)
        ) {
            revert InvalidRoleAccount(role, account);
        }
    }

    function _validateDestination(address currentOwner, address destination) private view {
        if (
            destination == address(0) || destination == address(1) || destination == burnAddress
                || destination == address(robinToken) || destination == address(this) || destination == currentOwner
        ) {
            revert InvalidDestination(destination);
        }
        if (_everHeldScroll[destination]) revert DestinationPreviouslyHeldScroll(destination);
    }

    function _validateMintPrice(uint256 price, uint256 minimum, uint256 maximum) private pure {
        if (price < minimum || price > maximum) revert InvalidMintPrice(price);
        if (price % 2 != 0) revert OddMintPrice(price);
    }

    function _checkDeadline(uint256 deadline) private view {
        if (block.timestamp > deadline) revert AuthorizationExpired(deadline, block.timestamp);
    }

    function _checkAwardIds(bytes32[] calldata ids, bool achievements, uint256 maximum) private pure {
        uint256 length = ids.length;
        if (length > maximum) revert AwardBatchTooLarge(achievements, length, maximum);

        bytes32 previous = bytes32(0);
        for (uint256 i = 0; i < length; ++i) {
            if (ids[i] == bytes32(0) || (i != 0 && uint256(ids[i]) <= uint256(previous))) {
                revert AwardIdsNotStrictlyIncreasing(achievements, i);
            }
            previous = ids[i];
        }
    }

    function _toDecimalString(uint256 value) private pure returns (string memory) {
        if (value == 0) return "0";

        uint256 digits = 0;
        uint256 remaining = value;
        while (remaining != 0) {
            ++digits;
            remaining /= 10;
        }

        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            unchecked {
                --digits;
                buffer[digits] = bytes1(uint8(48 + (value % 10)));
            }
            value /= 10;
        }
        return string(buffer);
    }
}
