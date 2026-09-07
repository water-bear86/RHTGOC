// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {RobinHoodScroll} from "../src/RobinHoodScroll.sol";
import {MockRobin, MockTimelock} from "./mocks/MockRobin.sol";
import {TestBase} from "./utils/TestBase.sol";

contract ScrollEconomicsHandler is TestBase {
    uint256 private constant MIN_PRICE = 200 ether;
    uint256 private constant MAX_PRICE = 20_000 ether;

    MockRobin public immutable robin;
    RobinHoodScroll public immutable scroll;
    address public immutable timelock;
    address public immutable treasury;
    address public immutable guardian;

    uint256 public totalPaid;
    uint256 public mintedCount;
    address[8] private _actors;

    constructor(MockRobin robin_, RobinHoodScroll scroll_, address timelock_, address treasury_, address guardian_) {
        robin = robin_;
        scroll = scroll_;
        timelock = timelock_;
        treasury = treasury_;
        guardian = guardian_;

        for (uint256 i; i < _actors.length; ++i) {
            _actors[i] = address(uint160(0x10_000 + i));
            robin_.mint(_actors[i], MAX_PRICE * 100);
            vm.prank(_actors[i]);
            robin_.approve(address(scroll_), type(uint256).max);
        }
    }

    function mint(uint256 actorSeed) external {
        address actor = _actors[actorSeed % _actors.length];
        if (scroll.paused() || scroll.hasEverHeldScroll(actor)) return;

        uint256 price = scroll.mintPrice();
        vm.prank(actor);
        scroll.mint();
        totalPaid += price;
        ++mintedCount;
    }

    function setValidPrice(uint256 seed) external {
        uint256 allowedPrices = ((MAX_PRICE - MIN_PRICE) / 2) + 1;
        uint256 nextPrice = MIN_PRICE + ((seed % allowedPrices) * 2);
        vm.prank(timelock);
        scroll.setMintPrice(nextPrice);
    }

    function togglePause() external {
        if (scroll.paused()) {
            vm.prank(timelock);
            scroll.unpause();
        } else {
            vm.prank(guardian);
            scroll.pause();
        }
    }

    function actorAt(uint256 index) external view returns (address) {
        return _actors[index];
    }

    function actorCount() external pure returns (uint256) {
        return 8;
    }
}

contract RobinHoodScrollInvariantTest is TestBase {
    uint256 private constant PRICE = 2_000 ether;
    uint256 private constant MIN_PRICE = 200 ether;
    uint256 private constant MAX_PRICE = 20_000 ether;
    address private constant TREASURY = address(0x7000);
    address private constant GUARDIAN = address(0x7001);
    address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    MockRobin private robin;
    MockTimelock private timelock;
    RobinHoodScroll private scroll;
    ScrollEconomicsHandler private handler;
    address[] private _targets;

    function setUp() public {
        robin = new MockRobin();
        timelock = new MockTimelock();
        scroll = new RobinHoodScroll(
            IERC20(address(robin)),
            DEAD_ADDRESS,
            TREASURY,
            PRICE,
            MIN_PRICE,
            MAX_PRICE,
            "https://scrolls.example/scrolls/",
            address(timelock),
            GUARDIAN,
            address(0x7003),
            address(0x7004),
            address(0x7005)
        );
        handler = new ScrollEconomicsHandler(robin, scroll, address(timelock), TREASURY, GUARDIAN);
        _targets.push(address(handler));
    }

    function targetContracts() public view returns (address[] memory) {
        return _targets;
    }

    function invariantEveryMintPreservesExactHalfSplit() public view {
        assertEq(robin.balanceOf(TREASURY), handler.totalPaid() / 2);
        assertEq(robin.balanceOf(DEAD_ADDRESS), handler.totalPaid() / 2);
        assertEq(robin.balanceOf(address(scroll)), 0);
    }

    function invariantWalletsNeverReceiveMoreThanOneScroll() public view {
        uint256 counted;
        for (uint256 i; i < handler.actorCount(); ++i) {
            address actor = handler.actorAt(i);
            uint256 tokenId = scroll.scrollOf(actor);
            if (tokenId != 0) {
                ++counted;
                assertTrue(scroll.hasScroll(actor));
                assertTrue(scroll.hasEverHeldScroll(actor));
                assertEq(scroll.ownerOf(tokenId), actor);
            } else {
                assertFalse(scroll.hasScroll(actor));
            }
        }
        assertEq(counted, handler.mintedCount());
    }

    function invariantPriceAlwaysInsideImmutableEvenBounds() public view {
        uint256 price = scroll.mintPrice();
        assertTrue(price >= scroll.minMintPrice());
        assertTrue(price <= scroll.maxMintPrice());
        assertEq(price % 2, 0);
    }
}
