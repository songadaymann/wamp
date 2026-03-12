// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { RoomOwnershipToken } from "../src/RoomOwnershipToken.sol";

interface Vm {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

abstract contract Script {
    Vm internal constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}

contract DeployRoomOwnershipToken is Script {
    uint256 internal constant DEFAULT_INITIAL_MINT_PRICE = 0.01 ether;

    function run() external returns (RoomOwnershipToken token) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address initialOwner = vm.envAddress("ROOM_MINT_OWNER_ADDRESS");
        address initialMintAuthority = vm.envAddress("ROOM_MINT_AUTH_ADDRESS");
        address initialWithdrawAuthority = vm.envAddress("ROOM_MINT_WITHDRAW_ADDRESS");

        vm.startBroadcast(privateKey);
        token = new RoomOwnershipToken(
            initialOwner,
            initialMintAuthority,
            initialWithdrawAuthority,
            DEFAULT_INITIAL_MINT_PRICE
        );
        vm.stopBroadcast();
    }
}
