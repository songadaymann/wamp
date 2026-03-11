// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { RoomOwnershipToken } from "../src/RoomOwnershipToken.sol";

contract RoomOwnershipTokenTest {
    function testMintRoomAssignsOwnerAndStoresRoomKey() public {
        RoomOwnershipToken token = new RoomOwnershipToken();
        uint256 mintPrice = token.MINT_PRICE();

        uint256 tokenId = token.mintRoom{ value: mintPrice }(7, -3);

        require(token.ownerOf(tokenId) == address(this), "owner mismatch");
        require(tokenId == 1, "unexpected token id");
        require(token.tokenIdForRoomKey(token.roomKeyForCoordinates(7, -3)) == tokenId, "room mapping mismatch");
    }

    function testMintRoomRejectsSecondMintForSameCoordinates() public {
        RoomOwnershipToken token = new RoomOwnershipToken();
        uint256 mintPrice = token.MINT_PRICE();

        token.mintRoom{ value: mintPrice }(1, 2);

        (bool ok,) = address(token).call{ value: mintPrice }(
            abi.encodeWithSelector(token.mintRoom.selector, int32(1), int32(2))
        );

        require(!ok, "expected duplicate mint to fail");
    }

    function testMintRoomRequiresExactMintPrice() public {
        RoomOwnershipToken token = new RoomOwnershipToken();

        (bool ok,) = address(token).call{ value: 0.009 ether }(
            abi.encodeWithSelector(token.mintRoom.selector, int32(0), int32(0))
        );

        require(!ok, "expected wrong price to fail");
    }
}
