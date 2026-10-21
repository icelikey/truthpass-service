pragma solidity ^0.8.24;

interface ITruthPassPaidEvidenceAnchor {
    function recordPurchase(
        bytes32 purchaseId,
        bytes32 consumerCommitment,
        bytes32 batchCommitment,
        bytes32 purchaseProofHash,
        bytes32 consentHash,
        uint256 chainId,
        bytes32 domain
    ) external returns (bool newlyStored);

    function recordContribution(
        bytes32 contributionId,
        bytes32 purchaseId,
        bytes32 evidenceHash,
        bytes32 contributionHash,
        uint8 score,
        uint256 chainId,
        bytes32 domain
    ) external returns (bool newlyStored);
}

/// @title TruthPassPaidConsumerGatewayV2
/// @notice Consumer purchase gateway with an explicit native-asset payment.
/// @dev The first pilot uses one immutable price and merchant. Raw order data
///      remains off-chain; only commitments and the payment event are on-chain.
contract TruthPassPaidConsumerGatewayV2 {
    ITruthPassPaidEvidenceAnchor public immutable anchor;
    uint256 public immutable chainId;
    bytes32 public immutable anchorDomain;
    address payable public immutable merchant;
    uint256 public immutable purchasePriceWei;

    mapping(bytes32 => address) public purchaseOwner;

    error InvalidAddress();
    error InvalidPrice();
    error PurchaseAlreadyBound(bytes32 purchaseId);
    error PurchaseNotOwned(bytes32 purchaseId, address caller);
    error IncorrectPayment(uint256 expected, uint256 actual);

    event ConsumerPurchaseSubmitted(
        bytes32 indexed purchaseId,
        bytes32 indexed batchCommitment,
        address indexed consumer,
        bool newlyStored
    );
    event PaymentReceived(
        bytes32 indexed purchaseId,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        uint256 chainId
    );
    event ConsumerContributionSubmitted(
        bytes32 indexed contributionId,
        bytes32 indexed purchaseId,
        address indexed consumer,
        bool newlyStored
    );

    constructor(
        address anchorAddress,
        uint256 expectedChainId,
        bytes32 domain,
        address payable merchantAddress,
        uint256 priceWei
    ) {
        if (anchorAddress == address(0) || merchantAddress == address(0)) revert InvalidAddress();
        if (expectedChainId == 0 || domain == bytes32(0)) revert InvalidAddress();
        if (priceWei == 0) revert InvalidPrice();
        anchor = ITruthPassPaidEvidenceAnchor(anchorAddress);
        chainId = expectedChainId;
        anchorDomain = domain;
        merchant = merchantAddress;
        purchasePriceWei = priceWei;
    }

    function consumerCommitment(address consumer) public pure returns (bytes32) {
        return keccak256(abi.encode("truthpass:consumer:v1", consumer));
    }

    function recordPaidPurchase(
        bytes32 purchaseId,
        bytes32 batchCommitment,
        bytes32 purchaseProofHash,
        bytes32 consentHash
    ) external payable returns (bool newlyStored) {
        if (purchaseOwner[purchaseId] != address(0)) revert PurchaseAlreadyBound(purchaseId);
        if (msg.value != purchasePriceWei) revert IncorrectPayment(purchasePriceWei, msg.value);

        purchaseOwner[purchaseId] = msg.sender;
        newlyStored = anchor.recordPurchase(
            purchaseId,
            consumerCommitment(msg.sender),
            batchCommitment,
            purchaseProofHash,
            consentHash,
            chainId,
            anchorDomain
        );

        (bool sent, ) = merchant.call{value: msg.value}("");
        require(sent, "merchant payment failed");
        emit PaymentReceived(purchaseId, msg.sender, merchant, msg.value, chainId);
        emit ConsumerPurchaseSubmitted(purchaseId, batchCommitment, msg.sender, newlyStored);
    }

    function recordContribution(
        bytes32 contributionId,
        bytes32 purchaseId,
        bytes32 evidenceHash,
        bytes32 contributionHash,
        uint8 score
    ) external returns (bool newlyStored) {
        address owner = purchaseOwner[purchaseId];
        if (owner != msg.sender) revert PurchaseNotOwned(purchaseId, msg.sender);
        newlyStored = anchor.recordContribution(
            contributionId,
            purchaseId,
            evidenceHash,
            contributionHash,
            score,
            chainId,
            anchorDomain
        );
        emit ConsumerContributionSubmitted(contributionId, purchaseId, msg.sender, newlyStored);
    }
}
