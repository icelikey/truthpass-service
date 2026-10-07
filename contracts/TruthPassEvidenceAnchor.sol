// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TruthPassEvidenceAnchor
/// @notice Minimal append-only anchor for TruthPass evidence and verification results.
/// @dev The contract stores commitments and workflow state only. Raw reports, device
///      telemetry, personal data and model prompts must remain off-chain.
///
/// This contract intentionally does not claim that an on-chain commitment makes a
/// real-world measurement true. It records which authorized writer submitted which
/// commitment, under which chain domain and policy/version hashes.
contract TruthPassEvidenceAnchor {
    bytes32 public constant DEFAULT_ADMIN_ROLE = bytes32(0);
    bytes32 public constant EVIDENCE_WRITER_ROLE = keccak256("EVIDENCE_WRITER_ROLE");
    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant PURCHASE_WRITER_ROLE = keccak256("PURCHASE_WRITER_ROLE");
    bytes32 public constant CONTRIBUTION_WRITER_ROLE = keccak256("CONTRIBUTION_WRITER_ROLE");
    bytes32 public constant DISPUTE_ROLE = keccak256("DISPUTE_ROLE");
    bytes32 public constant REVOKER_ROLE = keccak256("REVOKER_ROLE");

    bytes32 private constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256("TruthPassEvidenceAnchor");
    bytes32 private constant VERSION_HASH = keccak256("1");

    /// @notice The chain on which this instance was deployed. A changed chain id
    ///         makes all writes fail instead of silently accepting cross-chain data.
    uint256 public immutable DEPLOYED_CHAIN_ID;
    bytes32 public immutable DOMAIN_SEPARATOR;

    // State values are deliberately numeric so the ABI remains stable across clients.
    uint8 public constant STATE_NONE = 0;
    uint8 public constant STATE_ACCEPTED = 1;
    uint8 public constant STATE_REVIEW = 2;
    uint8 public constant STATE_REJECTED = 3;
    uint8 public constant STATE_DISPUTED = 4;
    uint8 public constant STATE_REVOKED = 5;
    uint8 public constant STATE_SUPERSEDED = 6;

    uint8 public constant TARGET_EVIDENCE = 1;
    uint8 public constant TARGET_VERIFICATION = 2;
    uint8 public constant TARGET_PURCHASE = 3;
    uint8 public constant TARGET_CONTRIBUTION = 4;

    struct EvidenceAnchor {
        bytes32 evidenceRoot;
        bytes32 subjectHash;
        bytes32 schemaHash;
        bytes32 sourceHash;
        uint8 state;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct Verification {
        bytes32 evidenceRoot;
        bytes32 taskHash;
        bytes32 policyHash;
        bytes32 verifierVersionHash;
        bytes32 resultHash;
        uint8 state;
        uint8 scope;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct Purchase {
        bytes32 consumerCommitment;
        bytes32 batchCommitment;
        bytes32 purchaseProofHash;
        bytes32 consentHash;
        uint8 state;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct Contribution {
        bytes32 purchaseId;
        bytes32 evidenceHash;
        bytes32 contributionHash;
        uint8 score;
        uint8 state;
        uint64 createdAt;
        uint64 updatedAt;
    }

    struct Dispute {
        uint8 targetKind;
        bytes32 targetId;
        bytes32 reasonHash;
        address raisedBy;
        uint64 createdAt;
    }

    struct Revision {
        uint8 targetKind;
        bytes32 replacementId;
        bytes32 reasonHash;
        bool superseded;
        uint64 createdAt;
    }

    mapping(bytes32 => mapping(address => bool)) private _roles;
    mapping(bytes32 => EvidenceAnchor) public evidenceByRequest;
    mapping(bytes32 => bytes32) public evidenceRequestByRoot;
    mapping(bytes32 => Verification) public verificationByRequest;
    mapping(bytes32 => Purchase) public purchaseById;
    mapping(bytes32 => Contribution) public contributionById;
    mapping(bytes32 => bytes32) public contributionByPurchase;
    mapping(bytes32 => Dispute) public disputeById;
    mapping(bytes32 => Revision) public revisionByTarget;

    error AccessDenied(bytes32 role, address account);
    error WrongChain(uint256 expected, uint256 actual);
    error WrongDomain(bytes32 expected, bytes32 actual);
    error ZeroCommitment();
    error InvalidState(uint8 state);
    error InvalidTargetKind(uint8 targetKind);
    error IdempotencyMismatch(bytes32 requestId);
    error EvidenceRootAlreadyAnchored(bytes32 root, bytes32 existingRequestId);
    error EvidenceNotAnchored(bytes32 root);
    error RecordMissing(bytes32 recordId);
    error DuplicatePurchaseContribution(bytes32 purchaseId, bytes32 existingContributionId);
    error ScoreOutOfRange(uint8 score);

    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);
    event EvidenceAnchored(
        bytes32 indexed requestId,
        bytes32 indexed evidenceRoot,
        bytes32 indexed subjectHash,
        bytes32 schemaHash,
        bytes32 sourceHash,
        uint8 state,
        address writer
    );
    event VerificationRecorded(
        bytes32 indexed requestId,
        bytes32 indexed evidenceRoot,
        bytes32 indexed taskHash,
        bytes32 policyHash,
        bytes32 verifierVersionHash,
        bytes32 resultHash,
        uint8 state,
        uint8 scope,
        address verifier
    );
    event PurchaseRecorded(
        bytes32 indexed purchaseId,
        bytes32 indexed consumerCommitment,
        bytes32 indexed batchCommitment,
        bytes32 purchaseProofHash,
        bytes32 consentHash,
        address writer
    );
    event ContributionRecorded(
        bytes32 indexed contributionId,
        bytes32 indexed purchaseId,
        bytes32 indexed evidenceHash,
        bytes32 contributionHash,
        uint8 score,
        address writer
    );
    event DisputeRaised(
        bytes32 indexed disputeId,
        uint8 indexed targetKind,
        bytes32 indexed targetId,
        bytes32 reasonHash,
        address raisedBy
    );
    event RecordRevokedOrSuperseded(
        uint8 indexed targetKind,
        bytes32 indexed targetId,
        bytes32 indexed replacementId,
        bytes32 reasonHash,
        bool superseded,
        address writer
    );

    modifier onlyRole(bytes32 role) {
        if (!_roles[role][msg.sender]) revert AccessDenied(role, msg.sender);
        _;
    }

    constructor() {
        DEPLOYED_CHAIN_ID = block.chainid;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
        _roles[DEFAULT_ADMIN_ROLE][msg.sender] = true;
        emit RoleGranted(DEFAULT_ADMIN_ROLE, msg.sender, msg.sender);
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return _roles[role][account];
    }

    function grantRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (account == address(0)) revert ZeroCommitment();
        if (!_roles[role][account]) {
            _roles[role][account] = true;
            emit RoleGranted(role, account, msg.sender);
        }
    }

    function revokeRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (_roles[role][account]) {
            _roles[role][account] = false;
            emit RoleRevoked(role, account, msg.sender);
        }
    }

    /// @notice Anchor a normalized evidence graph. The same request/root may be
    ///         submitted repeatedly only with exactly the same content.
    function anchorEvidence(
        bytes32 requestId,
        bytes32 evidenceRoot,
        bytes32 subjectHash,
        bytes32 schemaHash,
        bytes32 sourceHash,
        uint8 state,
        uint256 chainId,
        bytes32 domain
    ) external onlyRole(EVIDENCE_WRITER_ROLE) returns (bool newlyStored) {
        _checkDomain(chainId, domain);
        _requireNonZero(requestId);
        _requireNonZero(evidenceRoot);
        _requireNonZero(subjectHash);
        _requireNonZero(schemaHash);
        _requireState(state);

        EvidenceAnchor storage prior = evidenceByRequest[requestId];
        if (prior.createdAt != 0) {
            if (
                prior.evidenceRoot != evidenceRoot || prior.subjectHash != subjectHash
                    || prior.schemaHash != schemaHash || prior.sourceHash != sourceHash
            ) revert IdempotencyMismatch(requestId);
            return false;
        }

        bytes32 existingRequestId = evidenceRequestByRoot[evidenceRoot];
        if (existingRequestId != bytes32(0) && existingRequestId != requestId) {
            revert EvidenceRootAlreadyAnchored(evidenceRoot, existingRequestId);
        }
        evidenceByRequest[requestId] = EvidenceAnchor(
            evidenceRoot,
            subjectHash,
            schemaHash,
            sourceHash,
            state,
            uint64(block.timestamp),
            uint64(block.timestamp)
        );
        evidenceRequestByRoot[evidenceRoot] = requestId;
        emit EvidenceAnchored(requestId, evidenceRoot, subjectHash, schemaHash, sourceHash, state, msg.sender);
        return true;
    }

    /// @notice Record the deterministic verifier output for an already anchored root.
    ///         JEV is an input/router and has no permission to call this function.
    function recordVerification(
        bytes32 requestId,
        bytes32 evidenceRoot,
        bytes32 taskHash,
        bytes32 policyHash,
        bytes32 verifierVersionHash,
        bytes32 resultHash,
        uint8 state,
        uint8 scope,
        uint256 chainId,
        bytes32 domain
    ) external onlyRole(VERIFIER_ROLE) returns (bool newlyStored) {
        _checkDomain(chainId, domain);
        _requireNonZero(requestId);
        _requireNonZero(evidenceRoot);
        _requireNonZero(taskHash);
        _requireNonZero(policyHash);
        _requireNonZero(verifierVersionHash);
        _requireNonZero(resultHash);
        _requireState(state);
        if (evidenceRequestByRoot[evidenceRoot] == bytes32(0)) revert EvidenceNotAnchored(evidenceRoot);

        Verification storage prior = verificationByRequest[requestId];
        if (prior.createdAt != 0) {
            if (
                prior.evidenceRoot != evidenceRoot || prior.taskHash != taskHash
                    || prior.policyHash != policyHash || prior.verifierVersionHash != verifierVersionHash
                    || prior.resultHash != resultHash || prior.scope != scope
            ) revert IdempotencyMismatch(requestId);
            return false;
        }
        verificationByRequest[requestId] = Verification(
            evidenceRoot,
            taskHash,
            policyHash,
            verifierVersionHash,
            resultHash,
            state,
            scope,
            uint64(block.timestamp),
            uint64(block.timestamp)
        );
        emit VerificationRecorded(
            requestId,
            evidenceRoot,
            taskHash,
            policyHash,
            verifierVersionHash,
            resultHash,
            state,
            scope,
            msg.sender
        );
        return true;
    }

    /// @notice Store a pseudonymous purchase commitment. No order, name or address belongs here.
    function recordPurchase(
        bytes32 purchaseId,
        bytes32 consumerCommitment,
        bytes32 batchCommitment,
        bytes32 purchaseProofHash,
        bytes32 consentHash,
        uint256 chainId,
        bytes32 domain
    ) external onlyRole(PURCHASE_WRITER_ROLE) returns (bool newlyStored) {
        _checkDomain(chainId, domain);
        _requireNonZero(purchaseId);
        _requireNonZero(consumerCommitment);
        _requireNonZero(batchCommitment);
        _requireNonZero(purchaseProofHash);
        _requireNonZero(consentHash);

        Purchase storage prior = purchaseById[purchaseId];
        if (prior.createdAt != 0) {
            if (
                prior.consumerCommitment != consumerCommitment || prior.batchCommitment != batchCommitment
                    || prior.purchaseProofHash != purchaseProofHash || prior.consentHash != consentHash
            ) revert IdempotencyMismatch(purchaseId);
            return false;
        }
        purchaseById[purchaseId] = Purchase(
            consumerCommitment,
            batchCommitment,
            purchaseProofHash,
            consentHash,
            STATE_ACCEPTED,
            uint64(block.timestamp),
            uint64(block.timestamp)
        );
        emit PurchaseRecorded(
            purchaseId,
            consumerCommitment,
            batchCommitment,
            purchaseProofHash,
            consentHash,
            msg.sender
        );
        return true;
    }

    /// @notice Record one contribution per purchase. A retry with the same id is idempotent.
    function recordContribution(
        bytes32 contributionId,
        bytes32 purchaseId,
        bytes32 evidenceHash,
        bytes32 contributionHash,
        uint8 score,
        uint256 chainId,
        bytes32 domain
    ) external onlyRole(CONTRIBUTION_WRITER_ROLE) returns (bool newlyStored) {
        _checkDomain(chainId, domain);
        _requireNonZero(contributionId);
        _requireNonZero(purchaseId);
        _requireNonZero(evidenceHash);
        _requireNonZero(contributionHash);
        if (score > 100) revert ScoreOutOfRange(score);
        if (purchaseById[purchaseId].createdAt == 0) revert RecordMissing(purchaseId);

        Contribution storage prior = contributionById[contributionId];
        if (prior.createdAt != 0) {
            if (
                prior.purchaseId != purchaseId || prior.evidenceHash != evidenceHash
                    || prior.contributionHash != contributionHash || prior.score != score
            ) revert IdempotencyMismatch(contributionId);
            return false;
        }
        bytes32 existingContributionId = contributionByPurchase[purchaseId];
        if (existingContributionId != bytes32(0) && existingContributionId != contributionId) {
            revert DuplicatePurchaseContribution(purchaseId, existingContributionId);
        }
        contributionById[contributionId] = Contribution(
            purchaseId,
            evidenceHash,
            contributionHash,
            score,
            STATE_ACCEPTED,
            uint64(block.timestamp),
            uint64(block.timestamp)
        );
        contributionByPurchase[purchaseId] = contributionId;
        emit ContributionRecorded(contributionId, purchaseId, evidenceHash, contributionHash, score, msg.sender);
        return true;
    }

    function raiseDispute(
        bytes32 disputeId,
        uint8 targetKind,
        bytes32 targetId,
        bytes32 reasonHash,
        uint256 chainId,
        bytes32 domain
    ) external onlyRole(DISPUTE_ROLE) returns (bool newlyStored) {
        _checkDomain(chainId, domain);
        _requireNonZero(disputeId);
        _requireNonZero(targetId);
        _requireNonZero(reasonHash);
        _requireTargetKind(targetKind);

        Dispute storage prior = disputeById[disputeId];
        if (prior.createdAt != 0) {
            if (
                prior.targetKind != targetKind || prior.targetId != targetId || prior.reasonHash != reasonHash
            ) revert IdempotencyMismatch(disputeId);
            return false;
        }
        disputeById[disputeId] = Dispute(targetKind, targetId, reasonHash, msg.sender, uint64(block.timestamp));
        _setTargetState(targetKind, targetId, STATE_DISPUTED);
        emit DisputeRaised(disputeId, targetKind, targetId, reasonHash, msg.sender);
        return true;
    }

    /// @notice Append a revocation or supersession marker; no historical record is deleted.
    function revokeOrSupersede(
        uint8 targetKind,
        bytes32 targetId,
        bytes32 replacementId,
        bytes32 reasonHash,
        uint256 chainId,
        bytes32 domain
    ) external onlyRole(REVOKER_ROLE) returns (bool newlyStored) {
        _checkDomain(chainId, domain);
        _requireNonZero(targetId);
        _requireNonZero(reasonHash);
        _requireTargetKind(targetKind);
        if (replacementId == targetId) revert IdempotencyMismatch(targetId);

        Revision storage prior = revisionByTarget[targetId];
        bool superseded = replacementId != bytes32(0);
        if (prior.createdAt != 0) {
            if (
                prior.targetKind != targetKind || prior.replacementId != replacementId
                    || prior.reasonHash != reasonHash || prior.superseded != superseded
            ) revert IdempotencyMismatch(targetId);
            return false;
        }
        _setTargetState(targetKind, targetId, superseded ? STATE_SUPERSEDED : STATE_REVOKED);
        revisionByTarget[targetId] = Revision(
            targetKind,
            replacementId,
            reasonHash,
            superseded,
            uint64(block.timestamp)
        );
        emit RecordRevokedOrSuperseded(targetKind, targetId, replacementId, reasonHash, superseded, msg.sender);
        return true;
    }

    function _checkDomain(uint256 chainId, bytes32 domain) internal view {
        if (block.chainid != DEPLOYED_CHAIN_ID || chainId != DEPLOYED_CHAIN_ID) {
            revert WrongChain(DEPLOYED_CHAIN_ID, block.chainid);
        }
        if (domain != DOMAIN_SEPARATOR) revert WrongDomain(DOMAIN_SEPARATOR, domain);
    }

    function _setTargetState(uint8 targetKind, bytes32 targetId, uint8 state) internal {
        if (targetKind == TARGET_EVIDENCE) {
            EvidenceAnchor storage evidence = evidenceByRequest[targetId];
            if (evidence.createdAt == 0) revert RecordMissing(targetId);
            evidence.state = state;
            evidence.updatedAt = uint64(block.timestamp);
        } else if (targetKind == TARGET_VERIFICATION) {
            Verification storage verification = verificationByRequest[targetId];
            if (verification.createdAt == 0) revert RecordMissing(targetId);
            verification.state = state;
            verification.updatedAt = uint64(block.timestamp);
        } else if (targetKind == TARGET_PURCHASE) {
            Purchase storage purchase = purchaseById[targetId];
            if (purchase.createdAt == 0) revert RecordMissing(targetId);
            purchase.state = state;
            purchase.updatedAt = uint64(block.timestamp);
        } else if (targetKind == TARGET_CONTRIBUTION) {
            Contribution storage contribution = contributionById[targetId];
            if (contribution.createdAt == 0) revert RecordMissing(targetId);
            contribution.state = state;
            contribution.updatedAt = uint64(block.timestamp);
        } else {
            revert InvalidTargetKind(targetKind);
        }
    }

    function _requireNonZero(bytes32 value) internal pure {
        if (value == bytes32(0)) revert ZeroCommitment();
    }

    function _requireState(uint8 state) internal pure {
        if (state < STATE_ACCEPTED || state > STATE_DISPUTED) revert InvalidState(state);
    }

    function _requireTargetKind(uint8 targetKind) internal pure {
        if (targetKind < TARGET_EVIDENCE || targetKind > TARGET_CONTRIBUTION) {
            revert InvalidTargetKind(targetKind);
        }
    }
}

