// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RobinHoodScroll} from "../src/RobinHoodScroll.sol";

interface DeploymentVm {
    function envUint(string calldata name) external returns (uint256 value);
    function envAddress(string calldata name) external returns (address value);
    function envString(string calldata name) external returns (string memory value);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Reproducible deployment only. Simulation is required before any broadcast.
contract DeployScroll {
    DeploymentVm private constant vm = DeploymentVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant VERIFIED_DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 private constant MIN_TIMELOCK_DELAY = 2 days;

    error InvalidDeploymentAddress(string field);
    error TimelockDelayTooShort(uint256 supplied);

    function run() external returns (TimelockController timelock, RobinHoodScroll scroll) {
        uint256 deployerPrivateKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address proposer = vm.envAddress("TIMELOCK_PROPOSER");
        address executor = vm.envAddress("TIMELOCK_EXECUTOR");
        uint256 timelockDelay = vm.envUint("TIMELOCK_MIN_DELAY_SECONDS");
        if (proposer == address(0)) revert InvalidDeploymentAddress("TIMELOCK_PROPOSER");
        if (executor == address(0)) revert InvalidDeploymentAddress("TIMELOCK_EXECUTOR");
        if (timelockDelay < MIN_TIMELOCK_DELAY) revert TimelockDelayTooShort(timelockDelay);
        address[] memory proposers = new address[](1);
        proposers[0] = proposer;
        address[] memory executors = new address[](1);
        executors[0] = executor;

        vm.startBroadcast(deployerPrivateKey);
        timelock = new TimelockController(timelockDelay, proposers, executors, address(0));
        scroll = new RobinHoodScroll(
            IERC20(vm.envAddress("ROBIN_TOKEN_ADDRESS")),
            VERIFIED_DEAD_ADDRESS,
            vm.envAddress("UPKEEP_TREASURY"),
            vm.envUint("SCROLL_INITIAL_MINT_PRICE"),
            vm.envUint("SCROLL_MIN_MINT_PRICE"),
            vm.envUint("SCROLL_MAX_MINT_PRICE"),
            vm.envString("SCROLL_METADATA_BASE_URI"),
            address(timelock),
            vm.envAddress("PAUSE_GUARDIAN"),
            vm.envAddress("CHECKPOINT_SIGNER"),
            vm.envAddress("RELAYER"),
            vm.envAddress("RECOVERY_SIGNER")
        );
        vm.stopBroadcast();
    }
}
