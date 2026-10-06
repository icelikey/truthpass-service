// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal public reputation anchor for TruthPass.
/// @dev Full evidence stays off-chain; this contract stores identity, result and hashes.
contract TrustRegistry {
    struct Service {
        address owner;
        string metadataURI;
        bool active;
    }

    struct Feedback {
        bytes32 serviceId;
        bytes32 taskHash;
        bytes32 evidenceHash;
        uint8 score;
        bool accepted;
        bool revoked;
        uint64 createdAt;
    }

    struct ConsumerPurchase {
        bytes32 consumerId;
        bytes32 batchId;
        bytes32 purchaseProofHash;
        bytes32 consentHash;
        uint64 createdAt;
    }

    mapping(bytes32 => Service) public services;
    mapping(bytes32 => Feedback) public feedback;
    mapping(bytes32 => ConsumerPurchase) public purchases;

    event ServiceRegistered(bytes32 indexed serviceId, address indexed owner, string metadataURI);
    event FeedbackRecorded(
        bytes32 indexed feedbackId,
        bytes32 indexed serviceId,
        bytes32 indexed taskHash,
        uint8 score,
        bool accepted,
        bytes32 evidenceHash
    );
    event FeedbackRevoked(bytes32 indexed feedbackId, bytes32 reasonHash);
    event ConsumerPurchaseRecorded(bytes32 indexed purchaseId, bytes32 indexed consumerId, bytes32 indexed batchId, bytes32 consentHash);
    event ConsumerContributionRecorded(bytes32 indexed contributionId, bytes32 indexed purchaseId, bytes32 indexed batchId, uint8 score, bytes32 evidenceHash);

    function registerService(bytes32 serviceId, string calldata metadataURI) external {
        require(services[serviceId].owner == address(0), "service exists");
        services[serviceId] = Service(msg.sender, metadataURI, true);
        emit ServiceRegistered(serviceId, msg.sender, metadataURI);
    }

    function recordFeedback(
        bytes32 serviceId,
        bytes32 taskHash,
        bytes32 evidenceHash,
        uint8 score,
        bool accepted
    ) external returns (bytes32 feedbackId) {
        require(services[serviceId].active, "service inactive");
        require(score <= 100, "score out of range");
        feedbackId = keccak256(abi.encode(msg.sender, serviceId, taskHash, evidenceHash));
        require(feedback[feedbackId].createdAt == 0, "feedback exists");
        feedback[feedbackId] = Feedback(
            serviceId,
            taskHash,
            evidenceHash,
            score,
            accepted,
            false,
            uint64(block.timestamp)
        );
        emit FeedbackRecorded(feedbackId, serviceId, taskHash, score, accepted, evidenceHash);
    }

    function revokeFeedback(bytes32 feedbackId, bytes32 reasonHash) external {
        Feedback storage item = feedback[feedbackId];
        require(item.createdAt != 0, "feedback missing");
        require(msg.sender == services[item.serviceId].owner, "not service owner");
        item.revoked = true;
        emit FeedbackRevoked(feedbackId, reasonHash);
    }

    function recordConsumerPurchase(
        bytes32 purchaseId,
        bytes32 consumerId,
        bytes32 batchId,
        bytes32 purchaseProofHash,
        bytes32 consentHash
    ) external {
        require(purchases[purchaseId].createdAt == 0, "purchase exists");
        purchases[purchaseId] = ConsumerPurchase(consumerId, batchId, purchaseProofHash, consentHash, uint64(block.timestamp));
        emit ConsumerPurchaseRecorded(purchaseId, consumerId, batchId, consentHash);
    }

    function recordConsumerContribution(
        bytes32 contributionId,
        bytes32 purchaseId,
        uint8 score,
        bytes32 evidenceHash
    ) external {
        ConsumerPurchase memory purchase = purchases[purchaseId];
        require(purchase.createdAt != 0, "purchase missing");
        require(score <= 100, "score out of range");
        emit ConsumerContributionRecorded(contributionId, purchaseId, purchase.batchId, score, evidenceHash);
    }
}
