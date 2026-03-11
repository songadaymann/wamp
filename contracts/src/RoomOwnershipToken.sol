// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract RoomOwnershipToken is ERC721 {
    uint256 public constant MINT_PRICE = 0.01 ether;

    mapping(bytes32 roomKey => uint256 tokenId) public tokenIdForRoomKey;

    uint256 private _nextTokenId = 1;

    event RoomMinted(
        uint256 indexed tokenId,
        bytes32 indexed roomKey,
        int32 x,
        int32 y,
        address indexed minter
    );

    constructor() ERC721("Everybody's Platformer Room", "EPRM") {}

    function roomKeyForCoordinates(int32 x, int32 y) public pure returns (bytes32) {
        return keccak256(abi.encode(x, y));
    }

    function tokenIdForRoomCoordinates(int32 x, int32 y) external view returns (uint256) {
        return tokenIdForRoomKey[roomKeyForCoordinates(x, y)];
    }

    function mintRoom(int32 x, int32 y) external payable returns (uint256 tokenId) {
        require(msg.value == MINT_PRICE, "Incorrect mint price.");

        bytes32 roomKey = roomKeyForCoordinates(x, y);
        require(tokenIdForRoomKey[roomKey] == 0, "Room already minted.");

        tokenId = _nextTokenId;
        _nextTokenId += 1;

        tokenIdForRoomKey[roomKey] = tokenId;
        _mint(msg.sender, tokenId);

        emit RoomMinted(tokenId, roomKey, x, y, msg.sender);
    }
}
