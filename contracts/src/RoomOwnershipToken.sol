// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { ERC721URIStorage } from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { MessageHashUtils } from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract RoomOwnershipToken is ERC721URIStorage, Ownable {
    uint256 public mintPriceWei;
    address public mintAuthority;
    address public withdrawAuthority;

    mapping(bytes32 roomKey => uint256 tokenId) public tokenIdForRoomKey;

    uint256 private _nextTokenId = 1;
    bytes32 private constant MINT_AUTHORIZATION_TYPEHASH =
        keccak256(
            "RoomMintAuthorization(uint256 chainId,address verifyingContract,int32 x,int32 y,address claimer,uint256 deadline)"
        );

    event RoomMinted(
        uint256 indexed tokenId,
        bytes32 indexed roomKey,
        int32 x,
        int32 y,
        address indexed minter
    );
    event MintPriceUpdated(uint256 mintPriceWei);
    event MintAuthorityUpdated(address indexed mintAuthority);
    event WithdrawAuthorityUpdated(address indexed withdrawAuthority);
    event RoomTokenURIUpdated(uint256 indexed tokenId, string tokenURI);
    event FundsWithdrawn(address indexed recipient, uint256 amount);

    constructor(
        address initialOwner,
        address initialMintAuthority,
        address initialWithdrawAuthority,
        uint256 initialMintPriceWei
    )
        ERC721("Everybody's Platformer Room", "EPRM")
        Ownable(initialOwner)
    {
        require(initialMintAuthority != address(0), "Mint authority required.");
        require(initialWithdrawAuthority != address(0), "Withdraw authority required.");

        mintAuthority = initialMintAuthority;
        withdrawAuthority = initialWithdrawAuthority;
        mintPriceWei = initialMintPriceWei;
    }

    function roomKeyForCoordinates(int32 x, int32 y) public pure returns (bytes32) {
        return keccak256(abi.encode(x, y));
    }

    function tokenIdForRoomCoordinates(int32 x, int32 y) external view returns (uint256) {
        return tokenIdForRoomKey[roomKeyForCoordinates(x, y)];
    }

    function mintAuthorizationHash(
        int32 x,
        int32 y,
        address claimer,
        uint256 deadline
    ) public view returns (bytes32) {
        return
            keccak256(
                abi.encode(
                    MINT_AUTHORIZATION_TYPEHASH,
                    block.chainid,
                    address(this),
                    x,
                    y,
                    claimer,
                    deadline
                )
            );
    }

    function mintRoom(
        int32 x,
        int32 y,
        address claimer,
        uint256 deadline,
        bytes calldata signature
    ) external payable returns (uint256 tokenId) {
        require(msg.sender == claimer, "Caller is not the authorized claimer.");
        require(block.timestamp <= deadline, "Mint authorization expired.");
        require(msg.value == mintPriceWei, "Incorrect mint price.");

        bytes32 roomKey = roomKeyForCoordinates(x, y);
        require(tokenIdForRoomKey[roomKey] == 0, "Room already minted.");
        require(_isValidMintAuthorization(x, y, claimer, deadline, signature), "Invalid mint authorization.");

        tokenId = _nextTokenId;
        _nextTokenId += 1;

        tokenIdForRoomKey[roomKey] = tokenId;
        _mint(msg.sender, tokenId);

        emit RoomMinted(tokenId, roomKey, x, y, msg.sender);
    }

    function setMintPriceWei(uint256 nextMintPriceWei) external onlyOwner {
        mintPriceWei = nextMintPriceWei;
        emit MintPriceUpdated(nextMintPriceWei);
    }

    function setMintAuthority(address nextMintAuthority) external onlyOwner {
        require(nextMintAuthority != address(0), "Mint authority required.");
        mintAuthority = nextMintAuthority;
        emit MintAuthorityUpdated(nextMintAuthority);
    }

    function setWithdrawAuthority(address nextWithdrawAuthority) external onlyOwner {
        require(nextWithdrawAuthority != address(0), "Withdraw authority required.");
        withdrawAuthority = nextWithdrawAuthority;
        emit WithdrawAuthorityUpdated(nextWithdrawAuthority);
    }

    function setTokenURI(uint256 tokenId, string calldata nextTokenURI) external {
        _setTokenURIWithAuthorization(tokenId, nextTokenURI);
    }

    function setRoomTokenURI(int32 x, int32 y, string calldata nextTokenURI) external {
        uint256 tokenId = tokenIdForRoomKey[roomKeyForCoordinates(x, y)];
        require(tokenId != 0, "Room is not minted.");
        _setTokenURIWithAuthorization(tokenId, nextTokenURI);
    }

    function withdraw() external {
        require(msg.sender == withdrawAuthority, "Only the withdraw authority can withdraw.");

        uint256 balance = address(this).balance;
        require(balance > 0, "No funds to withdraw.");

        (bool sent,) = payable(withdrawAuthority).call{ value: balance }("");
        require(sent, "Withdraw failed.");
        emit FundsWithdrawn(withdrawAuthority, balance);
    }

    function _isValidMintAuthorization(
        int32 x,
        int32 y,
        address claimer,
        uint256 deadline,
        bytes calldata signature
    ) internal view returns (bool) {
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(
            mintAuthorizationHash(x, y, claimer, deadline)
        );
        return ECDSA.recover(digest, signature) == mintAuthority;
    }

    function _setTokenURIWithAuthorization(uint256 tokenId, string calldata nextTokenURI) internal {
        address tokenOwner = _ownerOf(tokenId);
        require(tokenOwner != address(0), "Token does not exist.");
        require(
            msg.sender == owner() || msg.sender == tokenOwner,
            "Only the contract owner or token owner can update tokenURI."
        );

        _setTokenURI(tokenId, nextTokenURI);
        emit RoomTokenURIUpdated(tokenId, nextTokenURI);
    }
}
