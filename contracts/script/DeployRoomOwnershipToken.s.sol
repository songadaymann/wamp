// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { RoomOwnershipToken } from "../src/RoomOwnershipToken.sol";

interface Vm {
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

abstract contract Script {
    Vm internal constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}

contract DeployRoomOwnershipToken is Script {
    function run() external returns (RoomOwnershipToken token) {
        uint256 privateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(privateKey);
        token = new RoomOwnershipToken();
        vm.stopBroadcast();
    }
}
