// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RobinHoodScroll} from "../src/RobinHoodScroll.sol";
import {IRobinHoodScroll} from "../src/interfaces/IRobinHoodScroll.sol";
import {FeeOnTransferRobin, Mock1271Wallet, MockRobin, MockShortTimelock, MockTimelock} from "./mocks/MockRobin.sol";
import {TestBase} from "./utils/TestBase.sol";

contract RobinHoodScrollTest is TestBase {
    uint256 private constant PRICE = 2_000 ether;
    uint256 private constant MIN_PRICE = 200 ether;
    uint256 private constant MAX_PRICE = 20_000 ether;
    uint256 private constant PLAYER_PK = 0xA11CE;
    uint256 private constant CHECKPOINT_SIGNER_PK = 0xC0FFEE;
    uint256 private constant RELAYER_PK = 0xB0B;
    uint256 private constant RECOVERY_SIGNER_PK = 0xFACADE;
    uint256 private constant NEW_OWNER_PK = 0xBEEF01;
    uint256 private constant ATTACKER_PK = 0xBAD;

    address private constant TREASURY = address(0x7000);
    address private constant GUARDIAN = address(0x7001);
    address private constant SECOND_TREASURY = address(0x7002);
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    string private constant METADATA_URI = "https://scrolls.example/scrolls/";

    MockRobin private robin;
    MockTimelock private timelock;
    RobinHoodScroll private scroll;
    address private player;
    address private checkpointSigner;
    address private relayer;
    address private recoverySigner;
    address private newOwner;
    address private attacker;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
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
        uint256 indexed tokenId, address indexed previousOwner, address indexed nextOwner, uint256 nonce, bool recovery
    );

    function setUp() public {
        vm.warp(10_000);
        player = vm.addr(PLAYER_PK);
        checkpointSigner = vm.addr(CHECKPOINT_SIGNER_PK);
        relayer = vm.addr(RELAYER_PK);
        recoverySigner = vm.addr(RECOVERY_SIGNER_PK);
        newOwner = vm.addr(NEW_OWNER_PK);
        attacker = vm.addr(ATTACKER_PK);

        robin = new MockRobin();
        timelock = new MockTimelock();
        scroll = _deploy(IERC20(address(robin)), PRICE, MIN_PRICE, MAX_PRICE);
        robin.mint(player, MAX_PRICE * 2);
        vm.prank(player);
        robin.approve(address(scroll), type(uint256).max);
    }

    function testMintSplitsPaymentAndCreatesMetadataIdentity() public {
        vm.expectEmit(true, true, true, true, address(scroll));
        emit Transfer(address(0), player, 1);
        vm.expectEmit(true, true, false, true, address(scroll));
        emit ScrollPaymentSplit(1, player, PRICE, PRICE / 2, PRICE / 2);
        vm.expectEmit(true, true, false, true, address(scroll));
        emit ScrollMinted(1, player, PRICE);

        vm.prank(player);
        uint256 tokenId = scroll.mint();

        assertEq(tokenId, 1);
        assertEq(scroll.ownerOf(tokenId), player);
        assertEq(scroll.scrollOf(player), tokenId);
        assertTrue(scroll.hasScroll(player));
        assertTrue(scroll.hasEverHeldScroll(player));
        assertEq(robin.balanceOf(TREASURY), PRICE / 2);
        assertEq(robin.balanceOf(scroll.VERIFIED_DEAD_ADDRESS()), PRICE / 2);
        assertEq(robin.balanceOf(address(scroll)), 0);
        assertEq(scroll.currentTokenURI(tokenId), "https://scrolls.example/scrolls/1/metadata");
        assertEq(scroll.tokenURI(tokenId), "https://scrolls.example/scrolls/1/metadata");
        assertEq(scroll.name(), "Sherwood Scroll");
    }

    function testMintRejectsSecondScroll() public {
        _mintPlayer();
        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.AlreadyHeldScroll.selector, player));
        vm.prank(player);
        scroll.mint();
    }

    function testMintRejectsFeeOnTransferTokenAndRollsBack() public {
        FeeOnTransferRobin feeToken = new FeeOnTransferRobin();
        RobinHoodScroll feeScroll = _deploy(IERC20(address(feeToken)), PRICE, MIN_PRICE, MAX_PRICE);
        feeToken.mint(player, PRICE);
        vm.prank(player);
        feeToken.approve(address(feeScroll), type(uint256).max);

        vm.expectRevert();
        vm.prank(player);
        feeScroll.mint();

        assertEq(feeToken.balanceOf(player), PRICE);
        assertEq(feeToken.balanceOf(TREASURY), 0);
        assertFalse(feeScroll.hasEverHeldScroll(player));
    }

    function testConstructorRejectsPrecompileBurnAndNonContractTimelock() public {
        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.InvalidBurnAddress.selector, address(1)));
        new RobinHoodScroll(
            IERC20(address(robin)),
            address(1),
            TREASURY,
            PRICE,
            MIN_PRICE,
            MAX_PRICE,
            METADATA_URI,
            address(timelock),
            GUARDIAN,
            checkpointSigner,
            relayer,
            recoverySigner
        );

        vm.expectRevert(RobinHoodScroll.CheckpointKeySeparationRequired.selector);
        new RobinHoodScroll(
            IERC20(address(robin)),
            DEAD_ADDRESS,
            TREASURY,
            PRICE,
            MIN_PRICE,
            MAX_PRICE,
            METADATA_URI,
            address(timelock),
            GUARDIAN,
            relayer,
            relayer,
            recoverySigner
        );

        MockShortTimelock shortTimelock = new MockShortTimelock();
        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.TimelockDelayTooShort.selector, 1 hours, 2 days));
        new RobinHoodScroll(
            IERC20(address(robin)),
            DEAD_ADDRESS,
            TREASURY,
            PRICE,
            MIN_PRICE,
            MAX_PRICE,
            METADATA_URI,
            address(shortTimelock),
            GUARDIAN,
            checkpointSigner,
            relayer,
            recoverySigner
        );

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.InvalidTimelock.selector, attacker));
        new RobinHoodScroll(
            IERC20(address(robin)),
            DEAD_ADDRESS,
            TREASURY,
            PRICE,
            MIN_PRICE,
            MAX_PRICE,
            METADATA_URI,
            attacker,
            GUARDIAN,
            checkpointSigner,
            relayer,
            recoverySigner
        );
    }

    function testTimelockOnlyConfigAndEvenBoundedPrice() public {
        vm.expectRevert();
        vm.prank(attacker);
        scroll.setMintPrice(4_000 ether);

        vm.prank(address(timelock));
        scroll.setMintPrice(4_000 ether);
        assertEq(scroll.mintPrice(), 4_000 ether);

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.OddMintPrice.selector, MIN_PRICE + 1));
        vm.prank(address(timelock));
        scroll.setMintPrice(MIN_PRICE + 1);

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.InvalidMintPrice.selector, MIN_PRICE - 2));
        vm.prank(address(timelock));
        scroll.setMintPrice(MIN_PRICE - 2);

        vm.prank(address(timelock));
        scroll.setTreasury(SECOND_TREASURY);
        assertEq(scroll.treasury(), SECOND_TREASURY);

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.InvalidTreasury.selector, address(scroll)));
        vm.prank(address(timelock));
        scroll.setTreasury(address(scroll));

        vm.prank(address(timelock));
        scroll.setBaseMetadataURI("https://new.example/scrolls/");
        _mintPlayer();
        assertEq(scroll.currentTokenURI(1), "https://new.example/scrolls/1/metadata");
    }

    function testGuardianPausesButOnlyTimelockUnpauses() public {
        vm.prank(GUARDIAN);
        scroll.pause();
        assertTrue(scroll.paused());

        vm.expectRevert();
        vm.prank(GUARDIAN);
        scroll.unpause();

        vm.expectRevert();
        vm.prank(player);
        scroll.mint();

        vm.prank(address(timelock));
        scroll.unpause();
        assertFalse(scroll.paused());
    }

    function testSoulboundBlocksApprovalsAndEveryTransferEntryPoint() public {
        uint256 tokenId = _mintPlayer();

        vm.expectRevert(RobinHoodScroll.Soulbound.selector);
        vm.prank(player);
        scroll.approve(attacker, tokenId);

        vm.expectRevert(RobinHoodScroll.Soulbound.selector);
        vm.prank(player);
        scroll.setApprovalForAll(attacker, true);

        vm.expectRevert(RobinHoodScroll.Soulbound.selector);
        vm.prank(player);
        scroll.transferFrom(player, attacker, tokenId);

        vm.expectRevert(RobinHoodScroll.Soulbound.selector);
        vm.prank(player);
        scroll.safeTransferFrom(player, attacker, tokenId);

        vm.expectRevert(RobinHoodScroll.Soulbound.selector);
        vm.prank(player);
        scroll.safeTransferFrom(player, attacker, tokenId, hex"1234");
    }

    function testMigrationRequiresBothWalletsAndPreservesLifetimeLimit() public {
        uint256 tokenId = _mintPlayer();
        uint256 nonce = scroll.migrationNonces(tokenId);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = scroll.walletMigrationDigest(tokenId, newOwner, nonce, deadline);
        bytes memory ownerSignature = _signature(PLAYER_PK, digest);
        bytes memory destinationSignature = _signature(NEW_OWNER_PK, digest);

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.UnauthorizedMigrationSubmitter.selector, player));
        vm.prank(player);
        scroll.migrateWallet(tokenId, newOwner, nonce, deadline, ownerSignature, destinationSignature);

        vm.expectEmit(true, true, true, true, address(scroll));
        emit WalletMigrated(tokenId, player, newOwner, nonce, false);
        vm.prank(relayer);
        scroll.migrateWallet(tokenId, newOwner, nonce, deadline, ownerSignature, destinationSignature);

        assertEq(scroll.ownerOf(tokenId), newOwner);
        assertEq(scroll.scrollOf(player), 0);
        assertEq(scroll.scrollOf(newOwner), tokenId);
        assertFalse(scroll.hasScroll(player));
        assertTrue(scroll.hasEverHeldScroll(player));
        assertTrue(scroll.hasEverHeldScroll(newOwner));
        assertEq(scroll.migrationNonces(tokenId), 1);
        assertTrue(scroll.usedAuthorizations(digest));

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.AlreadyHeldScroll.selector, player));
        vm.prank(player);
        scroll.mint();
    }

    function testMigrationRejectsMissingDestinationConsentExpiredAndUnauthorizedCaller() public {
        uint256 tokenId = _mintPlayer();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = scroll.walletMigrationDigest(tokenId, newOwner, 0, deadline);
        bytes memory ownerSignature = _signature(PLAYER_PK, digest);

        bytes memory destinationSignature = _signature(NEW_OWNER_PK, digest);
        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.InvalidWalletConsent.selector, player));
        vm.prank(relayer);
        scroll.migrateWallet(tokenId, newOwner, 0, deadline, bytes(""), destinationSignature);

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.InvalidWalletConsent.selector, newOwner));
        vm.prank(relayer);
        scroll.migrateWallet(tokenId, newOwner, 0, deadline, ownerSignature, bytes(""));

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.UnauthorizedMigrationSubmitter.selector, attacker));
        vm.prank(attacker);
        scroll.migrateWallet(tokenId, newOwner, 0, deadline, ownerSignature, destinationSignature);

        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.AuthorizationExpired.selector, deadline, deadline + 1));
        vm.prank(relayer);
        scroll.migrateWallet(tokenId, newOwner, 0, deadline, ownerSignature, destinationSignature);
    }

    function testMigrationRejectsDestinationThatPreviouslyHeldAScroll() public {
        uint256 tokenId = _mintPlayer();
        robin.mint(newOwner, PRICE);
        vm.startPrank(newOwner);
        robin.approve(address(scroll), PRICE);
        scroll.mint();
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.DestinationPreviouslyHeldScroll.selector, newOwner));
        vm.prank(relayer);
        scroll.migrateWallet(tokenId, newOwner, 0, block.timestamp + 1 hours, bytes(""), bytes(""));
    }

    function testMigrationSupportsEip1271WalletConsent() public {
        uint256 tokenId = _mintPlayer();
        Mock1271Wallet smartWallet = new Mock1271Wallet(newOwner);
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = scroll.walletMigrationDigest(tokenId, address(smartWallet), 0, deadline);

        vm.prank(relayer);
        scroll.migrateWallet(
            tokenId, address(smartWallet), 0, deadline, _signature(PLAYER_PK, digest), _signature(NEW_OWNER_PK, digest)
        );

        assertEq(scroll.ownerOf(tokenId), address(smartWallet));
        assertEq(scroll.scrollOf(address(smartWallet)), tokenId);
    }

    function testRecoveryRequiresAuthorizedSeparateSignerAndRelayer() public {
        uint256 tokenId = _mintPlayer();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = scroll.walletRecoveryDigest(tokenId, newOwner, 0, deadline);
        bytes memory recoverySignature = _signature(RECOVERY_SIGNER_PK, digest);

        vm.expectEmit(true, true, true, true, address(scroll));
        emit WalletMigrated(tokenId, player, newOwner, 0, true);
        vm.prank(relayer);
        scroll.recoverWallet(tokenId, newOwner, 0, deadline, recoverySignature);

        assertEq(scroll.ownerOf(tokenId), newOwner);
        assertEq(scroll.recoveryNonces(tokenId), 1);
        assertTrue(scroll.usedAuthorizations(digest));
    }

    function testRecoveryRejectsUnauthorizedSignerAndEnforcesKeySeparation() public {
        uint256 tokenId = _mintPlayer();
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = scroll.walletRecoveryDigest(tokenId, newOwner, 0, deadline);
        bytes memory attackerSignature = _signature(ATTACKER_PK, digest);

        vm.expectRevert(
            abi.encodeWithSelector(RobinHoodScroll.UnauthorizedSigner.selector, attacker, scroll.RECOVERY_SIGNER_ROLE())
        );
        vm.prank(relayer);
        scroll.recoverWallet(tokenId, newOwner, 0, deadline, attackerSignature);

        vm.startPrank(address(timelock));
        scroll.grantRole(scroll.RELAYER_ROLE(), recoverySigner);
        vm.stopPrank();
        bytes memory recoverySignature = _signature(RECOVERY_SIGNER_PK, digest);
        vm.expectRevert(RobinHoodScroll.RecoveryKeySeparationRequired.selector);
        vm.prank(recoverySigner);
        scroll.recoverWallet(tokenId, newOwner, 0, deadline, recoverySignature);
    }

    function testCheckpointStoresRootAndEmitsAwardsWithinSameCall() public {
        uint256 tokenId = _mintPlayer();
        bytes32 root = keccak256("state-v1");
        IRobinHoodScroll.CheckpointInput memory input = _signedCheckpoint(tokenId, 1, root, 0);

        vm.expectEmit(true, true, true, true, address(scroll));
        emit StateCheckpointed(tokenId, 1, root, block.timestamp);
        vm.expectEmit(true, true, false, true, address(scroll));
        emit AchievementRecorded(tokenId, bytes32(uint256(1)), block.timestamp);
        vm.expectEmit(true, true, false, true, address(scroll));
        emit AchievementRecorded(tokenId, bytes32(uint256(2)), block.timestamp);
        vm.expectEmit(true, true, false, true, address(scroll));
        emit FineryUnlocked(tokenId, bytes32(uint256(7)), block.timestamp);
        vm.prank(relayer);
        scroll.submitCheckpoint(input);

        IRobinHoodScroll.Checkpoint memory stored = scroll.latestCheckpoint(tokenId);
        assertEq(stored.version, 1);
        assertEq(stored.stateRoot, root);
        assertEq(stored.timestamp, block.timestamp);
        assertEq(scroll.checkpointNonces(tokenId), 1);
        assertTrue(scroll.verifyCheckpoint(tokenId, 1, root));
        assertFalse(scroll.verifyCheckpoint(tokenId, 2, root));
    }

    function testCheckpointRejectsReplayStaleUnauthorizedAndWrongSigner() public {
        uint256 tokenId = _mintPlayer();
        IRobinHoodScroll.CheckpointInput memory input = _signedCheckpoint(tokenId, 1, keccak256("v1"), 0);

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.UnauthorizedCheckpointSubmitter.selector, attacker));
        vm.prank(attacker);
        scroll.submitCheckpoint(input);

        vm.expectRevert(
            abi.encodeWithSelector(RobinHoodScroll.UnauthorizedCheckpointSubmitter.selector, checkpointSigner)
        );
        vm.prank(checkpointSigner);
        scroll.submitCheckpoint(input);

        bytes32 relayerRole = scroll.RELAYER_ROLE();
        vm.prank(address(timelock));
        scroll.grantRole(relayerRole, checkpointSigner);
        vm.expectRevert(RobinHoodScroll.CheckpointKeySeparationRequired.selector);
        vm.prank(checkpointSigner);
        scroll.submitCheckpoint(input);
        vm.prank(address(timelock));
        scroll.revokeRole(relayerRole, checkpointSigner);

        vm.prank(relayer);
        scroll.submitCheckpoint(input);
        bytes32 digest = scroll.checkpointDigest(input);

        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.AuthorizationAlreadyUsed.selector, digest));
        vm.prank(relayer);
        scroll.submitCheckpoint(input);

        IRobinHoodScroll.CheckpointInput memory stale = _signedCheckpoint(tokenId, 1, keccak256("stale"), 1);
        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.StaleCheckpointVersion.selector, 1, 1));
        vm.prank(relayer);
        scroll.submitCheckpoint(stale);

        IRobinHoodScroll.CheckpointInput memory wrongSigner = _unsignedCheckpoint(tokenId, 2, keccak256("v2"), 1);
        wrongSigner.signature = _signature(ATTACKER_PK, scroll.checkpointDigest(wrongSigner));
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinHoodScroll.UnauthorizedSigner.selector, attacker, scroll.CHECKPOINT_SIGNER_ROLE()
            )
        );
        vm.prank(relayer);
        scroll.submitCheckpoint(wrongSigner);
    }

    function testCheckpointRejectsInvalidRootTimestampDeadlineAndAwardOrdering() public {
        uint256 tokenId = _mintPlayer();

        IRobinHoodScroll.CheckpointInput memory zeroRoot = _signedCheckpoint(tokenId, 1, bytes32(0), 0);
        vm.expectRevert(RobinHoodScroll.InvalidStateRoot.selector);
        vm.prank(relayer);
        scroll.submitCheckpoint(zeroRoot);

        IRobinHoodScroll.CheckpointInput memory future = _unsignedCheckpoint(tokenId, 1, keccak256("future"), 0);
        future.timestamp = block.timestamp + 1;
        future.signature = _signature(CHECKPOINT_SIGNER_PK, scroll.checkpointDigest(future));
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinHoodScroll.InvalidCheckpointTimestamp.selector, 0, block.timestamp + 1, block.timestamp
            )
        );
        vm.prank(relayer);
        scroll.submitCheckpoint(future);

        IRobinHoodScroll.CheckpointInput memory expired = _unsignedCheckpoint(tokenId, 1, keccak256("expired"), 0);
        expired.deadline = block.timestamp - 1;
        expired.signature = _signature(CHECKPOINT_SIGNER_PK, scroll.checkpointDigest(expired));
        vm.expectRevert(
            abi.encodeWithSelector(RobinHoodScroll.AuthorizationExpired.selector, block.timestamp - 1, block.timestamp)
        );
        vm.prank(relayer);
        scroll.submitCheckpoint(expired);

        IRobinHoodScroll.CheckpointInput memory unsorted = _unsignedCheckpoint(tokenId, 1, keccak256("awards"), 0);
        unsorted.achievementIds[0] = bytes32(uint256(2));
        unsorted.achievementIds[1] = bytes32(uint256(1));
        unsorted.signature = _signature(CHECKPOINT_SIGNER_PK, scroll.checkpointDigest(unsorted));
        vm.expectRevert(abi.encodeWithSelector(RobinHoodScroll.AwardIdsNotStrictlyIncreasing.selector, true, 1));
        vm.prank(relayer);
        scroll.submitCheckpoint(unsorted);
    }

    function testBatchSubmitsMultiplePlayerCheckpointsAtomically() public {
        uint256 firstTokenId = _mintPlayer();
        address secondPlayer = vm.addr(0xCAFE);
        robin.mint(secondPlayer, PRICE);
        vm.startPrank(secondPlayer);
        robin.approve(address(scroll), PRICE);
        uint256 secondTokenId = scroll.mint();
        vm.stopPrank();

        IRobinHoodScroll.CheckpointInput[] memory inputs = new IRobinHoodScroll.CheckpointInput[](2);
        inputs[0] = _signedCheckpoint(firstTokenId, 1, keccak256("first"), 0);
        inputs[1] = _signedCheckpoint(secondTokenId, 4, keccak256("second"), 0);

        vm.prank(relayer);
        scroll.submitCheckpoints(inputs);

        assertTrue(scroll.verifyCheckpoint(firstTokenId, 1, keccak256("first")));
        assertTrue(scroll.verifyCheckpoint(secondTokenId, 4, keccak256("second")));
    }

    function testCheckpointBatchAndAwardCapsPreventGasDenial() public {
        uint256 tokenId = _mintPlayer();
        IRobinHoodScroll.CheckpointInput[] memory empty = new IRobinHoodScroll.CheckpointInput[](0);
        vm.expectRevert(RobinHoodScroll.EmptyCheckpointBatch.selector);
        vm.prank(relayer);
        scroll.submitCheckpoints(empty);

        IRobinHoodScroll.CheckpointInput[] memory oversized = new IRobinHoodScroll.CheckpointInput[](33);
        vm.expectRevert(
            abi.encodeWithSelector(RobinHoodScroll.CheckpointBatchTooLarge.selector, uint256(33), uint256(32))
        );
        vm.prank(relayer);
        scroll.submitCheckpoints(oversized);

        IRobinHoodScroll.CheckpointInput memory input = _unsignedCheckpoint(tokenId, 1, keccak256("large"), 0);
        input.achievementIds = new bytes32[](65);
        for (uint256 i; i < input.achievementIds.length; ++i) {
            input.achievementIds[i] = bytes32(i + 1);
        }
        input.signature = _signature(CHECKPOINT_SIGNER_PK, scroll.checkpointDigest(input));
        vm.expectRevert(
            abi.encodeWithSelector(RobinHoodScroll.AwardBatchTooLarge.selector, true, uint256(65), uint256(64))
        );
        vm.prank(relayer);
        scroll.submitCheckpoint(input);
    }

    function testCheckpointAuthorizationIsInvalidatedByWalletMigration() public {
        uint256 tokenId = _mintPlayer();
        IRobinHoodScroll.CheckpointInput memory pending =
            _signedCheckpoint(tokenId, 1, keccak256("old-wallet-state"), 0);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 migrationDigest = scroll.walletMigrationDigest(tokenId, newOwner, 0, deadline);
        vm.prank(relayer);
        scroll.migrateWallet(
            tokenId,
            newOwner,
            0,
            deadline,
            _signature(PLAYER_PK, migrationDigest),
            _signature(NEW_OWNER_PK, migrationDigest)
        );

        address recoveredFromReboundDigest = _recoverForTest(scroll.checkpointDigest(pending), pending.signature);
        vm.expectRevert(
            abi.encodeWithSelector(
                RobinHoodScroll.UnauthorizedSigner.selector, recoveredFromReboundDigest, scroll.CHECKPOINT_SIGNER_ROLE()
            )
        );
        vm.prank(relayer);
        scroll.submitCheckpoint(pending);
    }

    function testFuzzExactEconomicsForEveryAllowedEvenPrice(uint96 seed) public {
        uint256 allowedPrices = ((MAX_PRICE - MIN_PRICE) / 2) + 1;
        uint256 fuzzPrice = MIN_PRICE + ((uint256(seed) % allowedPrices) * 2);
        MockRobin fuzzRobin = new MockRobin();
        RobinHoodScroll fuzzScroll = _deploy(IERC20(address(fuzzRobin)), fuzzPrice, MIN_PRICE, MAX_PRICE);
        fuzzRobin.mint(player, fuzzPrice);
        vm.startPrank(player);
        fuzzRobin.approve(address(fuzzScroll), fuzzPrice);
        fuzzScroll.mint();
        vm.stopPrank();

        assertEq(fuzzRobin.balanceOf(TREASURY), fuzzPrice / 2);
        assertEq(fuzzRobin.balanceOf(fuzzScroll.VERIFIED_DEAD_ADDRESS()), fuzzPrice / 2);
        assertEq(fuzzRobin.balanceOf(address(fuzzScroll)), 0);
    }

    function testFuzzCheckpointVersionsAreStrictlyMonotonic(uint64 firstVersion, uint64 secondVersion) public {
        vm.assume(firstVersion > 0);
        uint256 tokenId = _mintPlayer();
        IRobinHoodScroll.CheckpointInput memory first = _signedCheckpoint(tokenId, firstVersion, keccak256("first"), 0);
        vm.prank(relayer);
        scroll.submitCheckpoint(first);

        IRobinHoodScroll.CheckpointInput memory second =
            _signedCheckpoint(tokenId, secondVersion, keccak256("second"), 1);
        if (secondVersion <= firstVersion) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    RobinHoodScroll.StaleCheckpointVersion.selector, uint256(firstVersion), uint256(secondVersion)
                )
            );
            vm.prank(relayer);
            scroll.submitCheckpoint(second);
        } else {
            vm.prank(relayer);
            scroll.submitCheckpoint(second);
            assertTrue(scroll.verifyCheckpoint(tokenId, secondVersion, keccak256("second")));
        }
    }

    function _mintPlayer() private returns (uint256) {
        vm.prank(player);
        return scroll.mint();
    }

    function _unsignedCheckpoint(uint256 tokenId, uint256 version, bytes32 root, uint256 nonce)
        private
        view
        returns (IRobinHoodScroll.CheckpointInput memory input)
    {
        input.tokenId = tokenId;
        input.version = version;
        input.stateRoot = root;
        input.timestamp = block.timestamp;
        input.achievementIds = new bytes32[](2);
        input.achievementIds[0] = bytes32(uint256(1));
        input.achievementIds[1] = bytes32(uint256(2));
        input.fineryIds = new bytes32[](1);
        input.fineryIds[0] = bytes32(uint256(7));
        input.nonce = nonce;
        input.deadline = block.timestamp + 1 hours;
    }

    function _signedCheckpoint(uint256 tokenId, uint256 version, bytes32 root, uint256 nonce)
        private
        returns (IRobinHoodScroll.CheckpointInput memory input)
    {
        input = _unsignedCheckpoint(tokenId, version, root, nonce);
        input.signature = _signature(CHECKPOINT_SIGNER_PK, scroll.checkpointDigest(input));
    }

    function _deploy(IERC20 token, uint256 price, uint256 minimum, uint256 maximum) private returns (RobinHoodScroll) {
        return new RobinHoodScroll(
            token,
            DEAD_ADDRESS,
            TREASURY,
            price,
            minimum,
            maximum,
            METADATA_URI,
            address(timelock),
            GUARDIAN,
            checkpointSigner,
            relayer,
            recoverySigner
        );
    }

    function _recoverForTest(bytes32 digest, bytes memory signature) private pure returns (address recovered) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly ("memory-safe") {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        recovered = ecrecover(digest, v, r, s);
    }
}
