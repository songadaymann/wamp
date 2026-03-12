// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import { RoomOwnershipToken } from "../src/RoomOwnershipToken.sol";

interface Vm {
    function addr(uint256 privateKey) external returns (address);
    function deal(address account, uint256 newBalance) external;
    function prank(address msgSender) external;
    function sign(uint256 privateKey, bytes32 digest) external returns (uint8 v, bytes32 r, bytes32 s);
}

contract RoomOwnershipTokenTest {
    Vm internal constant vm =
        Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant AUTHORITY_PRIVATE_KEY = 0xA11CE;
    uint256 internal constant MINT_PRICE = 0.01 ether;
    address internal constant OWNER = address(0x1111);
    address internal constant WITHDRAW_AUTHORITY = address(0x4242);

    function testDeploymentUsesExplicitAuthorities() public {
        address authority = vm.addr(AUTHORITY_PRIVATE_KEY);
        RoomOwnershipToken token = deployToken(authority);

        require(token.owner() == OWNER, "owner mismatch");
        require(token.mintAuthority() == authority, "mint authority mismatch");
        require(token.withdrawAuthority() == WITHDRAW_AUTHORITY, "withdraw authority mismatch");
        require(token.owner() != address(this), "deployer should not remain owner");
        require(token.mintAuthority() != address(this), "deployer should not remain mint authority");
    }

    function testMintRoomRequiresAuthorizedClaimerSignature() public {
        address authority = vm.addr(AUTHORITY_PRIVATE_KEY);
        RoomOwnershipToken token = deployToken(authority);

        address claimer = address(0xBEEF);
        address attacker = address(0xCAFE);
        vm.deal(claimer, 1 ether);
        vm.deal(attacker, 1 ether);

        uint256 deadline = block.timestamp + 1 days;
        bytes memory authorization = signAuthorization(
            token,
            7,
            -3,
            claimer,
            deadline,
            AUTHORITY_PRIVATE_KEY
        );

        vm.prank(attacker);
        (bool attackerOk,) = address(token).call{ value: MINT_PRICE }(
            abi.encodeWithSelector(
                token.mintRoom.selector,
                int32(7),
                int32(-3),
                claimer,
                deadline,
                authorization
            )
        );
        require(!attackerOk, "expected non-claimer mint to fail");

        vm.prank(claimer);
        uint256 tokenId = token.mintRoom{ value: MINT_PRICE }(
            7,
            -3,
            claimer,
            deadline,
            authorization
        );

        require(token.ownerOf(tokenId) == claimer, "owner mismatch");
        require(tokenId == 1, "unexpected token id");
        require(token.tokenIdForRoomKey(token.roomKeyForCoordinates(7, -3)) == tokenId, "room mapping mismatch");
    }

    function testMintRoomRequiresCurrentPrice() public {
        address authority = vm.addr(AUTHORITY_PRIVATE_KEY);
        RoomOwnershipToken token = deployToken(authority);
        vm.prank(OWNER);
        token.setMintPriceWei(0.025 ether);

        address claimer = address(0x1234);
        vm.deal(claimer, 1 ether);

        uint256 deadline = block.timestamp + 1 days;
        bytes memory authorization = signAuthorization(
            token,
            1,
            2,
            claimer,
            deadline,
            AUTHORITY_PRIVATE_KEY
        );

        vm.prank(claimer);
        (bool wrongPriceOk,) = address(token).call{ value: MINT_PRICE }(
            abi.encodeWithSelector(
                token.mintRoom.selector,
                int32(1),
                int32(2),
                claimer,
                deadline,
                authorization
            )
        );
        require(!wrongPriceOk, "expected outdated price to fail");

        vm.prank(claimer);
        uint256 tokenId = token.mintRoom{ value: 0.025 ether }(
            1,
            2,
            claimer,
            deadline,
            authorization
        );
        require(token.ownerOf(tokenId) == claimer, "mint at updated price failed");
    }

    function testWithdrawSendsFundsToWithdrawAuthority() public {
        address authority = vm.addr(AUTHORITY_PRIVATE_KEY);
        RoomOwnershipToken token = deployToken(authority);

        address claimer = address(0xBADA55);
        vm.deal(claimer, 1 ether);

        uint256 deadline = block.timestamp + 1 days;
        bytes memory authorization = signAuthorization(
            token,
            3,
            4,
            claimer,
            deadline,
            AUTHORITY_PRIVATE_KEY
        );

        vm.prank(claimer);
        token.mintRoom{ value: MINT_PRICE }(3, 4, claimer, deadline, authorization);

        (bool nonAuthorityOk,) = address(token).call(
            abi.encodeWithSelector(token.withdraw.selector)
        );
        require(!nonAuthorityOk, "expected non-authority withdraw to fail");

        uint256 beforeBalance = WITHDRAW_AUTHORITY.balance;
        vm.prank(WITHDRAW_AUTHORITY);
        token.withdraw();
        require(WITHDRAW_AUTHORITY.balance == beforeBalance + MINT_PRICE, "withdraw mismatch");
    }

    function testTokenUriCanBeUpdatedByTokenOwnerOrContractOwner() public {
        address authority = vm.addr(AUTHORITY_PRIVATE_KEY);
        RoomOwnershipToken token = deployToken(authority);

        address claimer = address(0xABCD);
        address stranger = address(0xDEAD);
        vm.deal(claimer, 1 ether);

        uint256 deadline = block.timestamp + 1 days;
        bytes memory authorization = signAuthorization(
            token,
            -2,
            9,
            claimer,
            deadline,
            AUTHORITY_PRIVATE_KEY
        );

        vm.prank(claimer);
        uint256 tokenId = token.mintRoom{ value: MINT_PRICE }(
            -2,
            9,
            claimer,
            deadline,
            authorization
        );

        vm.prank(claimer);
        token.setTokenURI(tokenId, "ipfs://claimer-uri");
        require(
            keccak256(bytes(token.tokenURI(tokenId))) == keccak256(bytes("ipfs://claimer-uri")),
            "claimer tokenURI mismatch"
        );

        vm.prank(stranger);
        (bool strangerOk,) = address(token).call(
            abi.encodeWithSelector(token.setTokenURI.selector, tokenId, "ipfs://bad-uri")
        );
        require(!strangerOk, "expected stranger tokenURI update to fail");

        vm.prank(OWNER);
        token.setRoomTokenURI(-2, 9, "ipfs://owner-uri");
        require(
            keccak256(bytes(token.tokenURI(tokenId))) == keccak256(bytes("ipfs://owner-uri")),
            "owner tokenURI mismatch"
        );
    }

    function deployToken(address initialMintAuthority) internal returns (RoomOwnershipToken) {
        return new RoomOwnershipToken(OWNER, initialMintAuthority, WITHDRAW_AUTHORITY, MINT_PRICE);
    }

    function signAuthorization(
        RoomOwnershipToken token,
        int32 x,
        int32 y,
        address claimer,
        uint256 deadline,
        uint256 signerPrivateKey
    ) internal returns (bytes memory) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            token.mintAuthorizationHash(x, y, claimer, deadline)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPrivateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
