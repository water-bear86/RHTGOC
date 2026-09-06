// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice Minimal interface used to reject generic or zero-delay admin contracts.
interface ITimelockDelay {
    function getMinDelay() external view returns (uint256);
}

