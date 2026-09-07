// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockRobin is ERC20 {
    constructor() ERC20("Mock ROBIN", "ROBIN") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FeeOnTransferRobin is ERC20 {
    uint256 private constant FEE_BPS = 100;

    constructor() ERC20("Fee ROBIN", "fROBIN") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = (amount * FEE_BPS) / 10_000;
            super._update(from, to, amount - fee);
            super._update(from, address(0), fee);
        } else {
            super._update(from, to, amount);
        }
    }
}

contract MockTimelock {
    uint256 private immutable _delay;

    constructor() {
        _delay = 2 days;
    }

    function getMinDelay() external view returns (uint256) {
        return _delay;
    }
}

contract MockShortTimelock {
    function getMinDelay() external pure returns (uint256) {
        return 1 hours;
    }
}

contract Mock1271Wallet is IERC1271 {
    address private immutable _signer;

    constructor(address signer_) {
        _signer = signer_;
    }

    function isValidSignature(bytes32 hash, bytes memory signature) external view returns (bytes4) {
        return ECDSA.recover(hash, signature) == _signer ? IERC1271.isValidSignature.selector : bytes4(0xffffffff);
    }
}
