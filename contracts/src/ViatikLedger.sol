// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {Multicall} from "@openzeppelin/contracts/utils/Multicall.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";

/// @notice The parts of TestUSD the ledger uses.
interface ITestUSD {
    function MAX_MINT() external view returns (uint256);
    function mint(address to, uint256 amount) external;
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title ViatikLedger
/// @notice The onchain record of Viatik's money rules. It keeps every balance
/// (portfolio and funding vaults, accounts, budgets, Members) backed by
/// TestUSD held here, and enforces the rules that settle on Monad: roles,
/// self-approval, released <= funded <= committed, per-operation limits,
/// approved destinations, pauses, available funds and the Investor's
/// exception threshold. Period limits, categories and expiry stay offchain
/// (decision 66).
///
/// Ids are bytes32 = keccak256("<namespace>:<product id>") computed offchain.
/// People are their wallet address (`_msgSender()`, never `tx.origin`).
/// A policy rejection in `requestPayment` is a successful transaction that
/// emits `PaymentRejected`: a reverting call cannot be sponsored (spike 6.0).
contract ViatikLedger is Ownable, EIP712, Nonces, Multicall {
    // ─── Types ──────────────────────────────────────────────────────────────

    enum Role {
        None,
        Investor, // portfolio scope
        Admin, // agency scope
        Member // agency scope
    }

    enum LocationKind {
        None,
        PortfolioVault,
        FundingVault,
        Account,
        Budget
    }

    enum AgreementStatus {
        None,
        Pending,
        Active,
        Paused
    }

    enum TrancheStatus {
        None,
        Planned,
        Available,
        Requested,
        Released,
        Rejected
    }

    enum RequestStatus {
        None,
        Pending,
        Executed,
        Rejected,
        Closed
    }

    /// @notice Why `requestPayment` recorded a rejection (`PaymentRejected.reason`).
    enum Reason {
        None,
        BudgetPaused,
        DestinationNotAllowed,
        LimitExceeded,
        InsufficientFunds
    }

    /// @notice Which limit a `LimitExceeded` refers to.
    enum LimitRule {
        PerOperation,
        Commitment,
        Tranches,
        Exception,
        Deposit
    }

    /// @notice Receipt kinds hashed into `Recorded.receiptHash`.
    enum ReceiptKind {
        Deposit,
        Funding,
        TrancheRelease,
        Transfer,
        Payment,
        PaymentPending,
        PaymentRejected,
        Return,
        Allocation,
        Withdrawal,
        OutsidePayment,
        CapitalReturn
    }

    enum ScopeKind {
        None,
        Portfolio,
        Agency
    }

    struct Location {
        LocationKind kind;
        /// Portfolio id for a portfolio vault; agency id for everything else.
        bytes32 scope;
        uint256 balance;
    }

    struct Agreement {
        bytes32 agency;
        bytes32 vault;
        uint256 committed;
        uint256 funded;
        uint256 released;
        uint256 exceptionThreshold;
        AgreementStatus status;
    }

    struct Tranche {
        bytes32 agreement;
        uint256 amount;
        uint32 index;
        bool milestone;
        TrancheStatus status;
        address requestedBy;
        bytes32 destination;
        bytes32 evidenceHash;
    }

    struct Budget {
        bytes32 sourceAccount;
        uint256 perOperationLimit;
        uint256 approvalThreshold;
        bool paused;
        /// An empty allowlist accepts any destination. Destinations are labels onchain:
        /// vendor money always leaves through `payoutSink`.
        bool anyDestination;
        /// Bumped on every rules update, so the old allowlist stops counting.
        uint64 destinationEpoch;
    }

    struct Allowance {
        bool active;
        /// 0 = only the budget's per-operation limit applies.
        uint256 perOperationLimit;
        /// The holder's membership epoch when granted: a revocation invalidates it.
        uint64 epoch;
    }

    struct PaymentRequest {
        bytes32 budget;
        address requester;
        bytes32 destination;
        address member;
        uint256 amount;
        bytes32 evidenceHash;
        RequestStatus status;
        /// The requester's membership epoch when asking: a revocation invalidates it.
        uint64 epoch;
    }

    /// @notice A pending request carried over by genesis (see `importPendingRequest`).
    struct ImportedRequest {
        bytes32 requestId;
        bytes32 budget;
        address requester;
        bytes32 destination;
        address member;
        uint256 amount;
        bytes32 evidenceHash;
    }

    enum ScheduleStatus {
        None,
        Active,
        Paused,
        Cancelled,
        Completed
    }

    /// @notice A payment an Agency Admin authorizes once; the keeper only runs it when it is due.
    struct Schedule {
        bytes32 agency;
        /// An Account or a Budget of the agency, like `pay`.
        bytes32 source;
        /// The vendor paid (a label, like `pay`), or 0 when paying a Member.
        bytes32 destination;
        /// The Member credited to their Viatik balance, or 0 when paying a vendor.
        address member;
        /// The Admin who authorized it: if they lose the role, the schedule stops.
        address creator;
        /// Paid on every run.
        uint256 amount;
        uint64 nextRunAt;
        /// Seconds between runs; 0 = a single run.
        uint32 interval;
        uint32 runsLeft;
        ScheduleStatus status;
        /// Whether the Investor paused it: then only the Investor resumes it.
        bool pausedByInvestor;
    }

    /// @notice A payment an Admin made outside Viatik (to an address), and the proof anchored for it.
    struct OutsideProof {
        bool paid;
        /// The fingerprint of the invoice or receipt; 0 until the Admin anchors it.
        bytes32 evidenceHash;
    }

    /// @notice What `createSchedule` takes (a struct keeps the function readable).
    struct ScheduleInput {
        bytes32 id;
        bytes32 source;
        bytes32 destination;
        address member;
        uint256 amount;
        uint64 firstRunAt;
        uint32 interval;
        uint32 runs;
    }

    // ─── Errors (named like LedgerErrorCode, in PascalCase) ────────────────

    error NotAuthorized(address account);
    error AlreadyProcessed(bytes32 id);
    error InsufficientFunds(bytes32 location, uint256 available, uint256 amount);
    error LimitExceeded(LimitRule rule, uint256 limit, uint256 amount);
    error DestinationNotAllowed(bytes32 budget, bytes32 destination);
    error BudgetPaused(bytes32 budget);
    error AgreementPaused(bytes32 agreement);
    error NotRegistered(bytes32 id);
    error InvalidState(bytes32 id);
    /// @notice A schedule is not due yet (`dueAt` is when it will be).
    error NotDue(bytes32 schedule, uint64 dueAt);
    error SchedulePaused(bytes32 schedule);

    // ─── Events ─────────────────────────────────────────────────────────────

    event Recorded(bytes32 indexed opId, address indexed actor, bytes32 receiptHash);

    event PortfolioCreated(bytes32 indexed portfolio, bytes32 vault, address investor);
    event AgencyRegistered(bytes32 indexed agency, bytes32 indexed portfolio, bytes32 fundingVault);
    event RoleSet(bytes32 indexed scope, address indexed account, Role role);
    event LocationCreated(bytes32 indexed id, LocationKind kind, bytes32 indexed scope);
    event OperationsAccountSet(bytes32 indexed agency, bytes32 account);

    event AgreementCreated(bytes32 indexed agreement, bytes32 indexed agency, bytes32 vault, uint256 committed);
    event AgreementAccepted(bytes32 indexed agreement, address admin);
    event AgreementPausedSet(bytes32 indexed agreement, bool paused);

    event Deposited(bytes32 indexed opId, bytes32 indexed portfolio, uint256 amount);
    event AgreementFunded(bytes32 indexed opId, bytes32 indexed agreement, uint256 amount, uint256 funded);
    event TrancheRequested(bytes32 indexed tranche, address requester, bytes32 account, bytes32 evidenceHash);
    event TrancheChangesRequested(bytes32 indexed tranche, bool rejected);
    event TrancheReleased(
        bytes32 indexed tranche, bytes32 indexed agreement, bytes32 account, uint256 amount, bytes32 decisionHash
    );

    event Transferred(bytes32 indexed opId, bytes32 from, bytes32 to, uint256 amount);
    event BudgetCreated(bytes32 indexed budget, bytes32 indexed agency, bytes32 sourceAccount, uint256 allocation);
    event BudgetAllocated(bytes32 indexed budget, int256 delta, uint256 balance);
    event BudgetRulesUpdated(bytes32 indexed budget, uint256 perOperationLimit, uint256 approvalThreshold);
    event BudgetPausedSet(bytes32 indexed budget, bool paused);
    event AllowanceSet(bytes32 indexed budget, address indexed holder, bool active, uint256 perOperationLimit);

    event PaymentExecuted(
        bytes32 indexed paymentId,
        bytes32 indexed requestId,
        bytes32 source,
        bytes32 destination,
        address member,
        uint256 amount,
        bytes32 evidenceHash
    );
    event PaymentPending(bytes32 indexed requestId, bytes32 indexed budget, address requester, uint256 amount);
    event PaymentApproved(bytes32 indexed requestId, bytes32 indexed paymentId, address approver);
    event PaymentRejected(
        bytes32 indexed requestId,
        bytes32 indexed budget,
        address requester,
        uint256 amount,
        Reason reason,
        uint256 limit
    );
    event RequestClosed(bytes32 indexed requestId, address by, bool declined);
    event FundsReturned(bytes32 indexed opId, bytes32 indexed agency, address member, bytes32 account, uint256 amount);

    /// @notice Money left the ledger as real TestUSD. `scope` is the portfolio or agency, `source`
    /// the vault or the Member's balance location, `to` where it went.
    event Withdrawn(bytes32 indexed opId, bytes32 indexed scope, bytes32 source, address indexed to, uint256 amount);

    event ScheduleCreated(
        bytes32 indexed schedule,
        bytes32 indexed agency,
        bytes32 source,
        bytes32 destination,
        address member,
        uint256 amount,
        uint64 firstRunAt,
        uint32 interval,
        uint32 runs
    );
    event ScheduleRan(bytes32 indexed schedule, bytes32 indexed paymentId, uint64 nextRunAt, uint32 runsLeft);
    event ScheduleStatusChanged(bytes32 indexed schedule, ScheduleStatus status, address by);

    /// @notice An Admin paid outside Viatik: TestUSD left the agency's `source` to `to`.
    event PaidOutside(
        bytes32 indexed opId, bytes32 indexed agency, address indexed to, bytes32 source, uint256 amount, bytes32 evidenceHash
    );
    /// @notice An Admin returned capital from an agency account to the Investor's Portfolio Vault.
    event CapitalReturned(
        bytes32 indexed opId,
        bytes32 indexed agency,
        bytes32 indexed agreement,
        bytes32 fromAccount,
        bytes32 vault,
        uint256 amount
    );
    /// @notice The proof of a payment made outside Viatik, anchored once.
    event EvidenceRecorded(bytes32 indexed opId, bytes32 indexed agency, address by, bytes32 evidenceHash);

    event RegistrarSet(address registrar);
    event PayoutSinkSet(address sink);
    event NamespaceSet(bytes32 namespace);
    event KeeperSet(address keeper);

    // ─── Storage ────────────────────────────────────────────────────────────

    bytes32 public constant JOIN_TYPEHASH =
        keccak256("Join(address account,bytes32 scope,uint8 role,uint256 nonce,uint256 deadline)");

    /// @notice The shortest gap between two runs of a schedule, and the most runs one can have.
    uint32 public constant MIN_INTERVAL = 60;
    uint32 public constant MAX_RUNS = 52;

    ITestUSD public immutable TOKEN;
    /// @notice Server key that signs role permits (never moves money).
    address public registrar;
    /// @notice Where vendor payments leave the ledger as real TestUSD transfers.
    address public payoutSink;
    bytes32 public namespace;
    /// @notice The only account that runs due schedules (it can pay nothing an Admin did not authorize).
    address public keeper;

    mapping(bytes32 scope => mapping(address account => Role)) private _roles;
    /// @notice Portfolio and agency ids live in one space and never collide.
    mapping(bytes32 scope => ScopeKind) public scopeKind;
    /// @dev Portfolios created by genesis: only those can receive more imported agencies.
    mapping(bytes32 portfolio => bool) private _importedPortfolio;
    /// @notice Bumped when someone loses their role in an agency, so their allowances and
    /// pending requests stop counting (and do not come back if they rejoin).
    mapping(bytes32 agency => mapping(address account => uint64)) public membershipEpoch;
    mapping(bytes32 agency => bytes32 portfolio) public agencyPortfolio;
    mapping(bytes32 agency => bytes32 account) public operationsAccount;
    mapping(bytes32 agency => bytes32[] agreements) private _agencyAgreements;

    mapping(bytes32 id => Location) private _locations;
    /// @notice The agreement a funding vault backs (0 while unbound).
    mapping(bytes32 vault => bytes32 agreement) public vaultAgreement;

    mapping(bytes32 id => Agreement) private _agreements;
    mapping(bytes32 agreement => bytes32[] tranches) private _agreementTranches;
    mapping(bytes32 id => Tranche) private _tranches;

    mapping(bytes32 id => Budget) private _budgets;
    mapping(bytes32 budget => mapping(uint64 epoch => mapping(bytes32 destination => bool))) private _allowed;
    mapping(bytes32 budget => mapping(address holder => Allowance)) private _allowances;

    mapping(bytes32 id => PaymentRequest) private _requests;
    mapping(bytes32 agency => mapping(address member => uint256)) private _memberBalances;
    mapping(bytes32 id => Schedule) private _schedules;
    mapping(bytes32 agency => mapping(bytes32 opId => OutsideProof)) private _outside;

    /// @notice Money operations already recorded, per actor: each opId runs once, and
    /// nobody can mark someone else's operation as done.
    mapping(address actor => mapping(bytes32 opId => bool)) private _processed;

    constructor(ITestUSD token, address registrar_, address payoutSink_)
        Ownable(msg.sender)
        EIP712("ViatikLedger", "1")
    {
        if (payoutSink_ == address(0) || payoutSink_ == address(this) || registrar_ == address(0)) {
            revert NotRegistered(bytes32(0));
        }
        TOKEN = token;
        registrar = registrar_;
        payoutSink = payoutSink_;
        emit RegistrarSet(registrar_);
        emit PayoutSinkSet(payoutSink_);
    }

    // ─── Portfolios, agencies and roles ────────────────────────────────────

    /// @notice Anyone can open a portfolio and becomes its Investor (`createPortfolio`).
    function createPortfolio(bytes32 portfolioId, bytes32 vaultId) external {
        if (portfolioId == bytes32(0)) revert InvalidState(portfolioId);
        if (scopeKind[portfolioId] != ScopeKind.None) revert AlreadyProcessed(portfolioId);
        address investor = _msgSender();
        scopeKind[portfolioId] = ScopeKind.Portfolio;
        _newLocation(vaultId, LocationKind.PortfolioVault, portfolioId);
        _setRole(portfolioId, investor, Role.Investor);
        emit PortfolioCreated(portfolioId, vaultId, investor);
    }

    /// @notice The Investor registers an agency and its first funding vault (`createAgency`).
    function registerAgency(bytes32 agencyId, bytes32 portfolioId, bytes32 fundingVaultId) external {
        _requireRole(portfolioId, Role.Investor);
        if (scopeKind[portfolioId] != ScopeKind.Portfolio) revert NotRegistered(portfolioId);
        if (agencyId == bytes32(0)) revert InvalidState(agencyId);
        if (scopeKind[agencyId] != ScopeKind.None) revert AlreadyProcessed(agencyId);
        scopeKind[agencyId] = ScopeKind.Agency;
        agencyPortfolio[agencyId] = portfolioId;
        _newLocation(fundingVaultId, LocationKind.FundingVault, agencyId);
        emit AgencyRegistered(agencyId, portfolioId, fundingVaultId);
    }

    /// @notice An invited person takes their role with a permit the registrar signed (`acceptInvitation`).
    function join(bytes32 scope, Role role, uint256 nonce, uint256 deadline, bytes calldata signature) external {
        address account = _msgSender();
        if (block.timestamp > deadline) revert NotAuthorized(account);
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(JOIN_TYPEHASH, account, scope, role, nonce, deadline)));
        (address signer, ECDSA.RecoverError failure,) = ECDSA.tryRecover(digest, signature);
        if (failure != ECDSA.RecoverError.NoError || signer != registrar || nonce != nonces(account)) {
            revert NotAuthorized(account);
        }
        _useNonce(account);
        _requireRoleFitsScope(scope, role);
        if (_roles[scope][account] != Role.None) revert InvalidState(scope);
        _setRole(scope, account, role);
    }

    /// @notice Removes someone's role (`revokeMembership`). Agency scope: its Admin or the
    /// portfolio's Investor; portfolio scope: an Investor. Nobody removes themselves.
    function revokeRole(bytes32 scope, address account) external {
        address caller = _msgSender();
        if (account == caller) revert NotAuthorized(caller);
        ScopeKind kind = scopeKind[scope];
        if (kind == ScopeKind.Portfolio) {
            _requireRole(scope, Role.Investor);
        } else if (kind == ScopeKind.Agency) {
            _requireAgencyManager(scope);
        } else {
            revert NotRegistered(scope);
        }
        if (_roles[scope][account] == Role.None) revert InvalidState(scope);
        if (kind == ScopeKind.Agency) membershipEpoch[scope][account] += 1;
        _setRole(scope, account, Role.None);
    }

    /// @notice Cancels a role permit that was signed but not used yet (an invitation
    /// withdrawn): burns the account's next nonce. Registrar or owner.
    function invalidatePermit(address account) external {
        address caller = _msgSender();
        if (caller != registrar && caller != owner()) revert NotAuthorized(caller);
        _useNonce(account);
    }

    // ─── Accounts ───────────────────────────────────────────────────────────

    /// @notice The Agency Admin opens an account. The first one opened as Operations is the
    /// agency's Operations account (like `activeOperationsAccount` in the engine).
    function createAccount(bytes32 accountId, bytes32 agencyId, bool isOperations) external {
        _requireRole(agencyId, Role.Admin);
        _newLocation(accountId, LocationKind.Account, agencyId);
        if (isOperations) _setOperations(agencyId, accountId);
    }

    /// @notice Moves money between two accounts of the same agency (`transferFunds`).
    function transfer(bytes32 opId, bytes32 fromAccount, bytes32 toAccount, uint256 amount) external {
        _claim(opId);
        bytes32 agency = _requireLocation(fromAccount, LocationKind.Account).scope;
        address caller = _requireRole(agency, Role.Admin);
        if (_requireLocation(toAccount, LocationKind.Account).scope != agency) revert NotAuthorized(caller);
        if (fromAccount == toAccount || amount == 0) revert InvalidState(toAccount);
        _move(fromAccount, toAccount, amount);
        emit Transferred(opId, fromAccount, toAccount, amount);
        _record(opId, ReceiptKind.Transfer, amount, fromAccount, toAccount, bytes32(0));
    }

    // ─── Funding ────────────────────────────────────────────────────────────

    /// @notice The Investor adds funds: TestUSD moves from their own account into the ledger
    /// (`addFunds`). The Investor approves the ledger for the amount beforehand.
    function deposit(bytes32 opId, bytes32 portfolioId, bytes32 vaultId, uint256 amount) external {
        _claim(opId);
        address investor = _requireRole(portfolioId, Role.Investor);
        Location storage vault = _requireLocation(vaultId, LocationKind.PortfolioVault);
        if (vault.scope != portfolioId) revert InvalidState(vaultId);
        uint256 max = TOKEN.MAX_MINT();
        if (amount == 0 || amount > max) revert LimitExceeded(LimitRule.Deposit, max, amount);
        vault.balance += amount;
        emit Deposited(opId, portfolioId, amount);
        _record(opId, ReceiptKind.Deposit, amount, bytes32(0), vaultId, bytes32(0));
        if (!TOKEN.transferFrom(investor, address(this), amount)) revert InvalidState(opId);
    }

    /// @notice The Investor creates an agreement for an agency (`createAgreement`). The funding
    /// vault is the agency's unbound one or a new one. The first tranche without a milestone
    /// starts available; every other tranche starts planned.
    function createAgreement(
        bytes32 agreementId,
        bytes32 agencyId,
        bytes32 vaultId,
        uint256 committed,
        uint256 exceptionThreshold,
        bytes32[] calldata trancheIds,
        uint256[] calldata amounts,
        bool[] calldata milestones
    ) external {
        _requireRole(_requireAgency(agencyId), Role.Investor);
        if (agreementId == bytes32(0)) revert InvalidState(agreementId);
        if (_agreements[agreementId].status != AgreementStatus.None) revert AlreadyProcessed(agreementId);
        if (trancheIds.length == 0 || amounts.length != trancheIds.length || milestones.length != trancheIds.length) {
            revert InvalidState(agreementId);
        }
        _bindVault(vaultId, agencyId, agreementId);
        uint256 total = _addTranches(agreementId, trancheIds, amounts, milestones);
        if (committed == 0 || total != committed) revert LimitExceeded(LimitRule.Tranches, committed, total);

        Agreement storage created = _agreements[agreementId];
        created.agency = agencyId;
        created.vault = vaultId;
        created.committed = committed;
        created.exceptionThreshold = exceptionThreshold;
        created.status = AgreementStatus.Pending;
        _agencyAgreements[agencyId].push(agreementId);
        emit AgreementCreated(agreementId, agencyId, vaultId, committed);
    }

    /// @notice The Agency Admin accepts the agreement (`acceptAgreement`).
    function acceptAgreement(bytes32 agreementId) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        _requireRole(agreement.agency, Role.Admin);
        if (agreement.status != AgreementStatus.Pending) revert InvalidState(agreementId);
        agreement.status = AgreementStatus.Active;
        emit AgreementAccepted(agreementId, _msgSender());
    }

    /// @notice The Investor pauses or resumes an accepted agreement (`setAgreementPaused`).
    function setAgreementPaused(bytes32 agreementId, bool paused) external {
        Agreement storage agreement = _requireAgreement(agreementId);
        _requireRole(agencyPortfolio[agreement.agency], Role.Investor);
        AgreementStatus from = paused ? AgreementStatus.Active : AgreementStatus.Paused;
        if (agreement.status != from) revert InvalidState(agreementId);
        agreement.status = paused ? AgreementStatus.Paused : AgreementStatus.Active;
        emit AgreementPausedSet(agreementId, paused);
    }

    /// @notice The Investor moves capital from the portfolio vault into the agreement's
    /// funding vault (`fundAgreement`). Allowed while pending, active or paused.
    function fundAgreement(bytes32 opId, bytes32 agreementId, bytes32 portfolioVault, uint256 amount) external {
        _claim(opId);
        Agreement storage agreement = _requireAgreement(agreementId);
        bytes32 portfolio = agencyPortfolio[agreement.agency];
        _requireRole(portfolio, Role.Investor);
        Location storage source = _requireLocation(portfolioVault, LocationKind.PortfolioVault);
        if (source.scope != portfolio) revert InvalidState(portfolioVault);
        if (amount == 0) revert InvalidState(opId);
        uint256 left = agreement.committed - agreement.funded;
        if (amount > left) revert LimitExceeded(LimitRule.Commitment, left, amount);
        _move(portfolioVault, agreement.vault, amount);
        agreement.funded += amount;
        emit AgreementFunded(opId, agreementId, amount, agreement.funded);
        _record(opId, ReceiptKind.Funding, amount, portfolioVault, agreement.vault, bytes32(0));
    }

    /// @notice The Agency Admin asks for a tranche (`requestTranche`), or sends milestone
    /// evidence (`submitMilestoneEvidence`, `evidenceHash` required), naming the account
    /// that receives it. A tranche sent back for changes can be requested again.
    function requestTranche(bytes32 trancheId, bytes32 destinationAccount, bytes32 evidenceHash) external {
        Tranche storage tranche = _requireTranche(trancheId);
        Agreement storage agreement = _agreements[tranche.agreement];
        address caller = _requireRole(agreement.agency, Role.Admin);
        _requireActive(tranche.agreement, agreement);
        if (tranche.status != TrancheStatus.Planned && tranche.status != TrancheStatus.Available) {
            revert InvalidState(trancheId);
        }
        if (tranche.milestone == (evidenceHash == bytes32(0))) revert InvalidState(trancheId);
        if (_requireLocation(destinationAccount, LocationKind.Account).scope != agreement.agency) {
            revert NotAuthorized(caller);
        }
        tranche.status = TrancheStatus.Requested;
        tranche.requestedBy = caller;
        tranche.destination = destinationAccount;
        tranche.evidenceHash = evidenceHash;
        emit TrancheRequested(trancheId, caller, destinationAccount, evidenceHash);
    }

    /// @notice The Investor sends milestone evidence back (`requestMilestoneChanges`): the
    /// tranche becomes available to request again, or rejected for good.
    function requestChanges(bytes32 trancheId, bool reject) external {
        Tranche storage tranche = _requireTranche(trancheId);
        Agreement storage agreement = _agreements[tranche.agreement];
        address caller = _requireRole(agencyPortfolio[agreement.agency], Role.Investor);
        if (caller == tranche.requestedBy) revert NotAuthorized(caller);
        if (!tranche.milestone || tranche.status != TrancheStatus.Requested) revert InvalidState(trancheId);
        tranche.status = reject ? TrancheStatus.Rejected : TrancheStatus.Available;
        emit TrancheChangesRequested(trancheId, reject);
    }

    /// @notice The Investor releases a tranche (`releaseTranche`). The money goes to the
    /// account the agency asked for, or to its Operations account when nobody asked
    /// (only for an available tranche without a milestone). Nobody releases their own request.
    function releaseTranche(bytes32 trancheId, bytes32 decisionHash) external {
        Tranche storage tranche = _requireTranche(trancheId);
        Agreement storage agreement = _agreements[tranche.agreement];
        address caller = _requireRole(agencyPortfolio[agreement.agency], Role.Investor);
        if (caller == tranche.requestedBy) revert NotAuthorized(caller);
        _requireActive(tranche.agreement, agreement);
        if (tranche.status == TrancheStatus.Released) revert AlreadyProcessed(trancheId);

        bytes32 destination;
        if (tranche.status == TrancheStatus.Requested) {
            destination = tranche.destination;
        } else if (tranche.status == TrancheStatus.Available && !tranche.milestone) {
            destination = operationsAccount[agreement.agency];
            if (destination == bytes32(0)) revert NotRegistered(agreement.agency);
        } else {
            revert InvalidState(trancheId);
        }
        uint256 available = agreement.funded - agreement.released;
        if (tranche.amount > available) revert InsufficientFunds(agreement.vault, available, tranche.amount);

        tranche.status = TrancheStatus.Released;
        _processed[caller][trancheId] = true;
        tranche.destination = destination;
        agreement.released += tranche.amount;
        _move(agreement.vault, destination, tranche.amount);

        bytes32[] storage tranches = _agreementTranches[tranche.agreement];
        uint256 next = uint256(tranche.index) + 1;
        if (next < tranches.length) {
            Tranche storage following = _tranches[tranches[next]];
            if (!following.milestone && following.status == TrancheStatus.Planned) {
                following.status = TrancheStatus.Available;
            }
        }
        emit TrancheReleased(trancheId, tranche.agreement, destination, tranche.amount, decisionHash);
        _record(trancheId, ReceiptKind.TrancheRelease, tranche.amount, agreement.vault, destination, decisionHash);
    }

    // ─── Budgets and allowances ─────────────────────────────────────────────

    /// @notice The Agency Admin creates a budget funded from one of its accounts (`createBudget`).
    function createBudget(
        bytes32 budgetId,
        bytes32 sourceAccount,
        uint256 perOperationLimit,
        uint256 approvalThreshold,
        bytes32[] calldata allowedDestinations,
        uint256 allocation
    ) external {
        bytes32 agency = _requireLocation(sourceAccount, LocationKind.Account).scope;
        _requireRole(agency, Role.Admin);
        _newLocation(budgetId, LocationKind.Budget, agency);
        Budget storage budget = _budgets[budgetId];
        budget.sourceAccount = sourceAccount;
        _setRules(budgetId, budget, perOperationLimit, approvalThreshold, allowedDestinations);
        emit BudgetCreated(budgetId, agency, sourceAccount, allocation);
        if (allocation > 0) {
            // The initial allocation is recorded under the budget's own id.
            _claim(budgetId);
            _move(sourceAccount, budgetId, allocation);
            _record(budgetId, ReceiptKind.Allocation, allocation, sourceAccount, budgetId, bytes32(0));
        }
    }

    /// @notice Moves money between a budget and its source account (`allocateToBudget`):
    /// a positive delta allocates, a negative one returns.
    function allocate(bytes32 opId, bytes32 budgetId, int256 delta) external {
        _claim(opId);
        Location storage location = _requireLocation(budgetId, LocationKind.Budget);
        _requireRole(location.scope, Role.Admin);
        if (delta == 0 || delta == type(int256).min) revert InvalidState(opId);
        bytes32 source = _budgets[budgetId].sourceAccount;
        (bytes32 from, bytes32 to, uint256 amount) =
            delta > 0 ? (source, budgetId, uint256(delta)) : (budgetId, source, uint256(-delta));
        _move(from, to, amount);
        emit BudgetAllocated(budgetId, delta, location.balance);
        _record(opId, ReceiptKind.Allocation, amount, from, to, bytes32(0));
    }

    /// @notice The Agency Admin changes a budget's onchain rules (`updateBudgetRules`).
    function updateRules(
        bytes32 budgetId,
        uint256 perOperationLimit,
        uint256 approvalThreshold,
        bytes32[] calldata allowedDestinations
    ) external {
        Location storage location = _requireLocation(budgetId, LocationKind.Budget);
        _requireRole(location.scope, Role.Admin);
        Budget storage budget = _budgets[budgetId];
        budget.destinationEpoch += 1;
        _setRules(budgetId, budget, perOperationLimit, approvalThreshold, allowedDestinations);
    }

    /// @notice Pauses or resumes a budget (`setBudgetPaused`): its Agency Admin or the
    /// portfolio's Investor.
    function setBudgetPaused(bytes32 budgetId, bool paused) external {
        Location storage location = _requireLocation(budgetId, LocationKind.Budget);
        _requireAgencyManager(location.scope);
        Budget storage budget = _budgets[budgetId];
        if (budget.paused == paused) revert InvalidState(budgetId);
        budget.paused = paused;
        emit BudgetPausedSet(budgetId, paused);
    }

    /// @notice Grants, edits or revokes (`active = false`) someone's spending access
    /// (`assignAllowance`, `revokeAllowance`). The period limit stays offchain.
    function setAllowance(bytes32 budgetId, address holder, bool active, uint256 perOperationLimit) external {
        bytes32 agency = _requireLocation(budgetId, LocationKind.Budget).scope;
        _requireRole(agency, Role.Admin);
        if (active && _roles[agency][holder] == Role.None) revert NotRegistered(bytes32(uint256(uint160(holder))));
        _allowances[budgetId][holder] = Allowance({
            active: active, perOperationLimit: active ? perOperationLimit : 0, epoch: membershipEpoch[agency][holder]
        });
        emit AllowanceSet(budgetId, holder, active, perOperationLimit);
    }

    // ─── Payments ───────────────────────────────────────────────────────────

    /// @notice A holder asks to spend from a budget (`requestPayment`). Never reverts for a
    /// rule of the budget: a rejection is recorded with `PaymentRejected`. Up to the
    /// approval threshold it pays at once; above it, it waits for `approvePayment`
    /// without holding funds; so does anything above the agency's exception threshold,
    /// which only the Investor approves. With `member` set (only to the requester
    /// themselves), the money goes to their Viatik balance instead of a vendor
    /// (reimbursements).
    function requestPayment(
        bytes32 requestId,
        bytes32 paymentId,
        bytes32 budgetId,
        bytes32 destinationId,
        address member,
        uint256 amount,
        bytes32 evidenceHash
    ) external returns (RequestStatus outcome) {
        address requester = _msgSender();
        bytes32 agency = _requireLocation(budgetId, LocationKind.Budget).scope;
        _requireHolder(budgetId, agency, requester);
        if (member != address(0) && (member != requester || destinationId != bytes32(0))) revert NotAuthorized(member);
        if (amount == 0) revert InvalidState(requestId);
        if (_requests[requestId].status != RequestStatus.None) revert AlreadyProcessed(requestId);
        _claim(requestId);

        (Reason reason, uint256 limit) = _check(budgetId, requester, destinationId, member, amount);
        _requests[requestId] = PaymentRequest({
            budget: budgetId,
            requester: requester,
            destination: destinationId,
            member: member,
            amount: amount,
            evidenceHash: evidenceHash,
            status: RequestStatus.Pending,
            epoch: membershipEpoch[agency][requester]
        });

        if (reason != Reason.None) {
            _requests[requestId].status = RequestStatus.Rejected;
            emit PaymentRejected(requestId, budgetId, requester, amount, reason, limit);
            _record(
                requestId, ReceiptKind.PaymentRejected, amount, budgetId, _target(destinationId, member), evidenceHash
            );
            return RequestStatus.Rejected;
        }
        if (amount > _budgets[budgetId].approvalThreshold || amount > exceptionThresholdOf(agency)) {
            emit PaymentPending(requestId, budgetId, requester, amount);
            _record(
                requestId, ReceiptKind.PaymentPending, amount, budgetId, _target(destinationId, member), evidenceHash
            );
            return RequestStatus.Pending;
        }
        _execute(requestId, paymentId, _requests[requestId]);
        return RequestStatus.Executed;
    }

    /// @notice Approves a pending request (`approveRequest`). Above the agency's exception
    /// threshold only the portfolio's Investor decides; otherwise only an Agency Admin.
    /// Nobody approves their own request. The budget's rules are checked again now: if
    /// the request no longer fits, this reverts and the request stays pending.
    function approvePayment(bytes32 requestId, bytes32 paymentId) external {
        PaymentRequest storage request = _requests[requestId];
        if (request.status != RequestStatus.Pending) revert InvalidState(requestId);
        bytes32 agency = _locations[request.budget].scope;
        address caller = _msgSender();
        if (caller == request.requester) revert NotAuthorized(caller);
        if (request.amount > exceptionThresholdOf(agency)) {
            _requireRole(agencyPortfolio[agency], Role.Investor);
        } else {
            _requireRole(agency, Role.Admin);
        }
        _requireHolder(request.budget, agency, request.requester);
        if (request.epoch != membershipEpoch[agency][request.requester]) revert NotAuthorized(request.requester);

        (Reason reason, uint256 limit) =
            _check(request.budget, request.requester, request.destination, request.member, request.amount);
        if (reason == Reason.BudgetPaused) revert BudgetPaused(request.budget);
        if (reason == Reason.DestinationNotAllowed) revert DestinationNotAllowed(request.budget, request.destination);
        if (reason == Reason.LimitExceeded) revert LimitExceeded(LimitRule.PerOperation, limit, request.amount);
        if (reason == Reason.InsufficientFunds) revert InsufficientFunds(request.budget, limit, request.amount);

        emit PaymentApproved(requestId, paymentId, caller);
        _execute(requestId, paymentId, request);
    }

    /// @notice Closes a pending request without paying: the requester cancels it, an Agency
    /// Admin declines it, or the portfolio's Investor declines an exception or a request
    /// whose requester lost their role (`cancelRequest`, `declineRequest`, cascades).
    function closeRequest(bytes32 requestId) external {
        PaymentRequest storage request = _requests[requestId];
        if (request.status != RequestStatus.Pending) revert InvalidState(requestId);
        address caller = _msgSender();
        bool declined = caller != request.requester;
        if (declined) {
            bytes32 agency = _locations[request.budget].scope;
            bool admin = _roles[agency][caller] == Role.Admin;
            bool stale = request.epoch != membershipEpoch[agency][request.requester]
                || _roles[agency][request.requester] == Role.None;
            bool investor = _roles[agencyPortfolio[agency]][caller] == Role.Investor
                && (stale || request.amount > exceptionThresholdOf(agency));
            if (!admin && !investor) revert NotAuthorized(caller);
        }
        request.status = RequestStatus.Closed;
        emit RequestClosed(requestId, caller, declined);
    }

    /// @notice The Agency Admin pays from an account or a budget (`sendPayment`, `payBill`,
    /// and each person of `sendTeamPayments` in one multicall). Paying from a budget
    /// applies its pause, per-operation limit and destinations. Above the exception
    /// threshold an Admin cannot pay at all.
    function pay(
        bytes32 paymentId,
        bytes32 source,
        bytes32 destinationId,
        address member,
        uint256 amount,
        bytes32 evidenceHash
    ) external {
        _claim(paymentId);
        Location storage from = _locations[source];
        if (from.kind != LocationKind.Account && from.kind != LocationKind.Budget) revert NotRegistered(source);
        bytes32 agency = from.scope;
        _requireRole(agency, Role.Admin);
        if (member != address(0) && _roles[agency][member] == Role.None) {
            revert NotRegistered(bytes32(uint256(uint160(member))));
        }
        if (amount == 0 || (member != address(0) && destinationId != bytes32(0))) revert InvalidState(paymentId);
        _requirePayable(source, from, agency, destinationId, member, amount);
        _payOut(paymentId, bytes32(0), source, agency, destinationId, member, amount, evidenceHash);
    }

    /// @notice A Member (or Agency Admin) sends money they received back to the agency's
    /// Operations account (`returnUnusedFunds`).
    function returnToAgency(bytes32 opId, bytes32 agencyId, uint256 amount) external {
        _claim(opId);
        address caller = _msgSender();
        Role role = _roles[agencyId][caller];
        if (role != Role.Member && role != Role.Admin) revert NotAuthorized(caller);
        bytes32 operations = operationsAccount[agencyId];
        if (operations == bytes32(0)) revert NotRegistered(agencyId);
        uint256 balance = _memberBalances[agencyId][caller];
        if (amount == 0 || amount > balance) revert InsufficientFunds(_memberLocation(caller), balance, amount);
        _memberBalances[agencyId][caller] = balance - amount;
        _locations[operations].balance += amount;
        emit FundsReturned(opId, agencyId, caller, operations, amount);
        _record(opId, ReceiptKind.Return, amount, _memberLocation(caller), operations, bytes32(0));
    }

    // ─── Withdrawals ────────────────────────────────────────────────────────

    /// @notice The Investor takes money out of a Portfolio Vault to `to` (`withdrawFunds`). Only a
    /// Portfolio Vault can be named: capital committed to an Agency (a funding vault) keeps its own
    /// flow of tranches and returns, so it can never leave through here.
    function withdraw(bytes32 opId, bytes32 portfolioId, bytes32 vaultId, uint256 amount, address to) external {
        _claim(opId);
        _requireRole(portfolioId, Role.Investor);
        Location storage vault = _requireLocation(vaultId, LocationKind.PortfolioVault);
        if (vault.scope != portfolioId) revert InvalidState(vaultId);
        if (amount == 0 || to == address(0) || to == address(this)) revert InvalidState(opId);
        _debit(vaultId, amount);
        emit Withdrawn(opId, portfolioId, vaultId, to, amount);
        // The receipt names where the money went: the address, as a bytes32.
        _record(opId, ReceiptKind.Withdrawal, amount, vaultId, _memberLocation(to), bytes32(0));
        if (!TOKEN.transfer(to, amount)) revert InvalidState(opId);
    }

    /// @notice Someone takes the money the agency paid them out of their Viatik balance to `to`
    /// (`withdrawBalance`). It only touches their own balance. It does not ask for a current
    /// role: money already paid to a person stays theirs even if they left the agency.
    function withdrawMemberBalance(bytes32 opId, bytes32 agencyId, uint256 amount, address to) external {
        _claim(opId);
        address caller = _msgSender();
        if (to == address(0) || to == address(this)) revert InvalidState(opId);
        uint256 balance = _memberBalances[agencyId][caller];
        if (amount == 0 || amount > balance) revert InsufficientFunds(_memberLocation(caller), balance, amount);
        _memberBalances[agencyId][caller] = balance - amount;
        emit Withdrawn(opId, agencyId, _memberLocation(caller), to, amount);
        _record(opId, ReceiptKind.Withdrawal, amount, _memberLocation(caller), _memberLocation(to), bytes32(0));
        if (!TOKEN.transfer(to, amount)) revert InvalidState(opId);
    }

    // ─── Paying outside Viatik and returning capital ───────────────────────

    /// @notice An Agency Admin pays something Viatik cannot pay directly (a tool, a
    /// subscription) by sending TestUSD from an agency account or budget to `to`
    /// (`payOutside`). The same limits as `pay` apply: a paused budget pays nothing, a
    /// budget's per-operation limit holds, and nothing above the Investor's exception
    /// threshold. A budget limited to approved vendors never pays an address: its list
    /// names vendors, and an address cannot be proven to be one of them. The proof
    /// (invoice) can come with the payment or later, through `recordEvidence`.
    function payOutside(bytes32 opId, bytes32 source, address to, uint256 amount, bytes32 evidenceHash) external {
        _claim(opId);
        Location storage from = _locations[source];
        if (from.kind != LocationKind.Account && from.kind != LocationKind.Budget) revert NotRegistered(source);
        bytes32 agency = from.scope;
        _requireRole(agency, Role.Admin);
        if (amount == 0 || to == address(0) || to == address(this) || to == address(TOKEN)) revert InvalidState(opId);
        if (from.kind == LocationKind.Budget) {
            Budget storage budget = _budgets[source];
            if (budget.paused) revert BudgetPaused(source);
            if (amount > budget.perOperationLimit) {
                revert LimitExceeded(LimitRule.PerOperation, budget.perOperationLimit, amount);
            }
            if (!budget.anyDestination) revert DestinationNotAllowed(source, bytes32(0));
        }
        uint256 threshold = exceptionThresholdOf(agency);
        if (amount > threshold) revert LimitExceeded(LimitRule.Exception, threshold, amount);
        _debit(source, amount);
        _outside[agency][opId] = OutsideProof({paid: true, evidenceHash: evidenceHash});
        emit PaidOutside(opId, agency, to, source, amount, evidenceHash);
        // The receipt names where the money went: the address, as a bytes32.
        _record(opId, ReceiptKind.OutsidePayment, amount, source, _memberLocation(to), evidenceHash);
        if (!TOKEN.transfer(to, amount)) revert InvalidState(opId);
    }

    /// @notice An Agency Admin anchors the proof (invoice, receipt) of a payment made outside
    /// Viatik, once (`addPaymentProof`). It cannot be replaced afterwards.
    function recordEvidence(bytes32 agencyId, bytes32 opId, bytes32 evidenceHash) external {
        address caller = _requireRole(agencyId, Role.Admin);
        OutsideProof storage proof = _outside[agencyId][opId];
        if (!proof.paid) revert NotRegistered(opId);
        if (evidenceHash == bytes32(0)) revert InvalidState(opId);
        if (proof.evidenceHash != bytes32(0)) revert AlreadyProcessed(opId);
        proof.evidenceHash = evidenceHash;
        emit EvidenceRecorded(opId, agencyId, caller, evidenceHash);
    }

    /// @notice An Agency Admin returns capital from one of the agency's accounts to the
    /// Investor's Portfolio Vault (`returnToInvestor`). Only an account (not a budget or a
    /// funding vault), only to the Portfolio Vault of this agency's portfolio. `agreementId`
    /// (optional) names the agreement it is returned under; its funded and released
    /// amounts do not change: they are history.
    function returnCapital(
        bytes32 opId,
        bytes32 fromAccount,
        bytes32 portfolioVault,
        bytes32 agreementId,
        uint256 amount,
        bytes32 evidenceHash
    ) external {
        _claim(opId);
        bytes32 agency = _requireLocation(fromAccount, LocationKind.Account).scope;
        _requireRole(agency, Role.Admin);
        if (_requireLocation(portfolioVault, LocationKind.PortfolioVault).scope != agencyPortfolio[agency]) {
            revert InvalidState(portfolioVault);
        }
        if (agreementId != bytes32(0) && _agreements[agreementId].agency != agency) revert InvalidState(agreementId);
        if (amount == 0) revert InvalidState(opId);
        _move(fromAccount, portfolioVault, amount);
        emit CapitalReturned(opId, agency, agreementId, fromAccount, portfolioVault, amount);
        _record(opId, ReceiptKind.CapitalReturn, amount, fromAccount, portfolioVault, evidenceHash);
    }

    // ─── Scheduled payments ─────────────────────────────────────────────────

    /// @notice An Agency Admin authorizes a payment to a Member or a vendor, once or on a cadence
    /// (`schedulePayment`). It must be payable today by the same rules as `pay`: a schedule can
    /// never authorize what the Admin could not pay by hand.
    function createSchedule(ScheduleInput calldata input) external {
        Location storage from = _locations[input.source];
        if (from.kind != LocationKind.Account && from.kind != LocationKind.Budget) revert NotRegistered(input.source);
        bytes32 agency = from.scope;
        address creator = _requireRole(agency, Role.Admin);
        if (input.id == bytes32(0)) revert InvalidState(input.id);
        if (_schedules[input.id].status != ScheduleStatus.None) revert AlreadyProcessed(input.id);
        bool toMember = input.member != address(0);
        // Exactly one payee: a Member or a vendor.
        if (toMember == (input.destination != bytes32(0))) revert InvalidState(input.id);
        if (toMember && _roles[agency][input.member] == Role.None) {
            revert NotRegistered(_memberLocation(input.member));
        }
        if (input.amount == 0 || input.runs == 0 || input.runs > MAX_RUNS || input.firstRunAt < block.timestamp) {
            revert InvalidState(input.id);
        }
        // A single run has no interval; a repeating one cannot be faster than MIN_INTERVAL.
        if (input.interval == 0 ? input.runs != 1 : input.interval < MIN_INTERVAL) revert InvalidState(input.id);
        _requirePayable(input.source, from, agency, input.destination, input.member, input.amount);

        Schedule storage created = _schedules[input.id];
        created.agency = agency;
        created.source = input.source;
        created.destination = input.destination;
        created.member = input.member;
        created.creator = creator;
        created.amount = input.amount;
        created.nextRunAt = input.firstRunAt;
        created.interval = input.interval;
        created.runsLeft = input.runs;
        created.status = ScheduleStatus.Active;
        emit ScheduleCreated(
            input.id,
            agency,
            input.source,
            input.destination,
            input.member,
            input.amount,
            input.firstRunAt,
            input.interval,
            input.runs
        );
    }

    /// @notice The keeper runs a due schedule (`runSchedule`). Everything is checked again now:
    /// that it is active and due, that its Admin still holds the role, and the same budget
    /// rules as `pay`. The payment is recorded under `paymentId`, with the keeper as actor.
    function runSchedule(bytes32 scheduleId, bytes32 paymentId) external {
        address caller = _msgSender();
        if (caller != keeper) revert NotAuthorized(caller);
        Schedule storage run = _schedules[scheduleId];
        if (run.status == ScheduleStatus.None) revert NotRegistered(scheduleId);
        if (run.status == ScheduleStatus.Paused) revert SchedulePaused(scheduleId);
        if (run.status != ScheduleStatus.Active) revert InvalidState(scheduleId);
        if (block.timestamp < run.nextRunAt) revert NotDue(scheduleId, run.nextRunAt);
        _claim(paymentId);
        if (_roles[run.agency][run.creator] != Role.Admin) revert NotAuthorized(run.creator);
        if (run.member != address(0) && _roles[run.agency][run.member] == Role.None) {
            revert NotRegistered(_memberLocation(run.member));
        }
        _requirePayable(run.source, _locations[run.source], run.agency, run.destination, run.member, run.amount);

        run.runsLeft -= 1;
        if (run.runsLeft == 0) {
            run.status = ScheduleStatus.Completed;
        } else {
            run.nextRunAt += run.interval;
        }
        emit ScheduleRan(scheduleId, paymentId, run.nextRunAt, run.runsLeft);
        _payOut(paymentId, bytes32(0), run.source, run.agency, run.destination, run.member, run.amount, bytes32(0));
    }

    /// @notice An Agency Admin or the Investor of the portfolio pauses an active schedule.
    function pauseSchedule(bytes32 scheduleId) external {
        Schedule storage target = _requireSchedule(scheduleId);
        (address caller, bool asInvestor) = _requireScheduleManager(target.agency);
        if (target.status != ScheduleStatus.Active) revert InvalidState(scheduleId);
        target.status = ScheduleStatus.Paused;
        target.pausedByInvestor = asInvestor;
        emit ScheduleStatusChanged(scheduleId, ScheduleStatus.Paused, caller);
    }

    /// @notice Resumes a paused schedule. If the Investor paused it, only the Investor resumes it.
    /// Dates that passed while it was paused are skipped, not paid: it goes on from the next date
    /// on its own cadence (a single run that was due runs as soon as possible).
    function resumeSchedule(bytes32 scheduleId) external {
        Schedule storage target = _requireSchedule(scheduleId);
        (address caller, bool asInvestor) = _requireScheduleManager(target.agency);
        if (target.status != ScheduleStatus.Paused) revert InvalidState(scheduleId);
        if (target.pausedByInvestor && !asInvestor) revert NotAuthorized(caller);
        target.status = ScheduleStatus.Active;
        target.pausedByInvestor = false;
        if (target.nextRunAt <= block.timestamp) {
            if (target.interval == 0) {
                target.nextRunAt = uint64(block.timestamp);
            } else {
                uint256 skipped = (block.timestamp - target.nextRunAt) / target.interval + 1;
                target.nextRunAt += uint64(skipped * target.interval);
            }
        }
        emit ScheduleStatusChanged(scheduleId, ScheduleStatus.Active, caller);
    }

    /// @notice An Agency Admin or the Investor cancels a schedule for good, paused or not.
    function cancelSchedule(bytes32 scheduleId) external {
        Schedule storage target = _requireSchedule(scheduleId);
        (address caller,) = _requireScheduleManager(target.agency);
        if (target.status != ScheduleStatus.Active && target.status != ScheduleStatus.Paused) {
            revert InvalidState(scheduleId);
        }
        target.status = ScheduleStatus.Cancelled;
        emit ScheduleStatusChanged(scheduleId, ScheduleStatus.Cancelled, caller);
    }

    // ─── Reads ──────────────────────────────────────────────────────────────

    function roleOf(bytes32 scope, address account) external view returns (Role) {
        return _roles[scope][account];
    }

    /// @notice Whether `actor` already recorded `opId` (the server's "already processed" lookup).
    function processed(address actor, bytes32 opId) external view returns (bool) {
        return _processed[actor][opId];
    }

    function balanceOf(bytes32 id) external view returns (uint256) {
        return _locations[id].balance;
    }

    function getLocation(bytes32 id) external view returns (Location memory) {
        return _locations[id];
    }

    function memberBalance(bytes32 agencyId, address member) external view returns (uint256) {
        return _memberBalances[agencyId][member];
    }

    function getAgreement(bytes32 id) external view returns (Agreement memory) {
        return _agreements[id];
    }

    function tranchesOf(bytes32 agreementId) external view returns (bytes32[] memory) {
        return _agreementTranches[agreementId];
    }

    function getTranche(bytes32 id) external view returns (Tranche memory) {
        return _tranches[id];
    }

    function getBudget(bytes32 id) external view returns (Budget memory) {
        return _budgets[id];
    }

    function isDestinationAllowed(bytes32 budgetId, bytes32 destinationId) external view returns (bool) {
        return _destinationAllowed(budgetId, _budgets[budgetId], destinationId);
    }

    function getAllowance(bytes32 budgetId, address holder) external view returns (Allowance memory) {
        return _allowances[budgetId][holder];
    }

    function getRequest(bytes32 id) external view returns (PaymentRequest memory) {
        return _requests[id];
    }

    function getSchedule(bytes32 id) external view returns (Schedule memory) {
        return _schedules[id];
    }

    /// @notice Whether an agency paid `opId` outside Viatik, and the proof anchored for it (0 if none yet).
    function outsidePayment(bytes32 agencyId, bytes32 opId) external view returns (bool paid, bytes32 evidenceHash) {
        OutsideProof storage proof = _outside[agencyId][opId];
        return (proof.paid, proof.evidenceHash);
    }

    /// @notice The exception threshold of an agency: the one of its governing agreement,
    /// the first (in creation order) that is active or paused. Without one, there are
    /// no exceptions.
    function exceptionThresholdOf(bytes32 agencyId) public view returns (uint256) {
        bytes32[] storage agreements = _agencyAgreements[agencyId];
        for (uint256 i; i < agreements.length; ++i) {
            Agreement storage candidate = _agreements[agreements[i]];
            if (candidate.status == AgreementStatus.Active || candidate.status == AgreementStatus.Paused) {
                return candidate.exceptionThreshold;
            }
        }
        return type(uint256).max;
    }

    /// @notice What `requestPayment` would decide for `holder`, for previews and simulation.
    function checkPayment(bytes32 budgetId, address holder, bytes32 destinationId, address member, uint256 amount)
        external
        view
        returns (Reason reason, uint256 limit)
    {
        return _check(budgetId, holder, destinationId, member, amount);
    }

    /// @notice The hash every `Recorded` event carries; anyone can recompute it from a receipt.
    function receiptHash(bytes32 opId, ReceiptKind kind, uint256 amount, bytes32 from, bytes32 to, bytes32 evidenceHash)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(opId, kind, amount, from, to, evidenceHash));
    }

    /// @notice The location id a Member's balance is reported under in receipts.
    function memberLocation(address member) external pure returns (bytes32) {
        return _memberLocation(member);
    }

    // ─── Owner: configuration and genesis ───────────────────────────────────

    function setRegistrar(address registrar_) external onlyOwner {
        if (registrar_ == address(0)) revert NotRegistered(bytes32(0));
        registrar = registrar_;
        emit RegistrarSet(registrar_);
    }

    function setPayoutSink(address sink) external onlyOwner {
        if (sink == address(0) || sink == address(this)) revert NotRegistered(bytes32(0));
        payoutSink = sink;
        emit PayoutSinkSet(sink);
    }

    function setKeeper(address keeper_) external onlyOwner {
        if (keeper_ == address(0)) revert NotRegistered(bytes32(0));
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    /// @notice Marks a new epoch of ids (each re-seed of the demo history).
    function setNamespace(bytes32 namespace_) external onlyOwner {
        namespace = namespace_;
        emit NamespaceSet(namespace_);
    }

    /// @notice Genesis: registers a portfolio (if new) and optionally one of its agencies.
    /// Send the whole genesis in one owner multicall with a fresh namespace, so nobody can
    /// squat a seeded id in between; an id taken by someone else makes this revert.
    function importScope(bytes32 portfolioId, bytes32 agencyId) external onlyOwner {
        if (portfolioId == bytes32(0)) revert InvalidState(portfolioId);
        if (!_importedPortfolio[portfolioId]) {
            // A portfolio someone opened before genesis would leave them as its Investor.
            if (scopeKind[portfolioId] != ScopeKind.None) revert AlreadyProcessed(portfolioId);
            scopeKind[portfolioId] = ScopeKind.Portfolio;
            _importedPortfolio[portfolioId] = true;
        }
        if (agencyId != bytes32(0)) {
            if (scopeKind[agencyId] != ScopeKind.None) revert AlreadyProcessed(agencyId);
            scopeKind[agencyId] = ScopeKind.Agency;
            agencyPortfolio[agencyId] = portfolioId;
        }
    }

    /// @notice Genesis: binds someone's role, or removes it (`Role.None`). After a wallet
    /// takeover, remove the old address and import the person's data again.
    function importRole(bytes32 scope, address account, Role role) external onlyOwner {
        if (role != Role.None) _requireRoleFitsScope(scope, role);
        if (role == Role.None && scopeKind[scope] == ScopeKind.Agency) membershipEpoch[scope][account] += 1;
        _setRole(scope, account, role);
    }

    /// @notice Genesis: creates a location with its balance, minting the TestUSD behind it.
    function importLocation(bytes32 id, LocationKind kind, bytes32 scope, uint256 balance, bool isOperations)
        external
        onlyOwner
    {
        if (kind == LocationKind.None || (isOperations && kind != LocationKind.Account)) {
            revert InvalidState(id);
        }
        _newLocation(id, kind, scope);
        if (isOperations) _setOperations(scope, id);
        if (balance > 0) {
            _locations[id].balance = balance;
            _mintToLedger(balance);
        }
    }

    /// @notice Genesis: an agreement with its progress so far. Its vault must exist.
    function importAgreement(
        bytes32 agreementId,
        Agreement calldata data,
        bytes32[] calldata trancheIds,
        Tranche[] calldata tranches
    ) external onlyOwner {
        if (
            trancheIds.length == 0 || trancheIds.length != tranches.length
                || _agreements[agreementId].status != AgreementStatus.None || data.status == AgreementStatus.None
                || data.released > data.funded || data.funded > data.committed
        ) revert InvalidState(agreementId);
        Location storage vault = _requireLocation(data.vault, LocationKind.FundingVault);
        if (vault.scope != data.agency || vaultAgreement[data.vault] != bytes32(0)) revert InvalidState(data.vault);
        if (vault.balance != data.funded - data.released) {
            revert InsufficientFunds(data.vault, vault.balance, data.funded - data.released);
        }
        _agreements[agreementId] = data;
        vaultAgreement[data.vault] = agreementId;
        _agencyAgreements[data.agency].push(agreementId);
        uint256 total;
        for (uint256 i; i < trancheIds.length; ++i) {
            if (_tranches[trancheIds[i]].status != TrancheStatus.None || tranches[i].status == TrancheStatus.None) {
                revert InvalidState(trancheIds[i]);
            }
            Tranche storage imported = _tranches[trancheIds[i]];
            imported.agreement = agreementId;
            imported.amount = tranches[i].amount;
            imported.index = uint32(i);
            imported.milestone = tranches[i].milestone;
            imported.status = tranches[i].status;
            imported.requestedBy = tranches[i].requestedBy;
            imported.destination = tranches[i].destination;
            imported.evidenceHash = tranches[i].evidenceHash;
            total += tranches[i].amount;
            _agreementTranches[agreementId].push(trancheIds[i]);
        }
        if (total != data.committed) revert LimitExceeded(LimitRule.Tranches, data.committed, total);
        emit AgreementCreated(agreementId, data.agency, data.vault, data.committed);
    }

    /// @notice Genesis: a budget's rules (the budget itself comes from `importLocation`).
    function importBudget(bytes32 budgetId, Budget calldata data, bytes32[] calldata allowedDestinations)
        external
        onlyOwner
    {
        bytes32 agency = _requireLocation(budgetId, LocationKind.Budget).scope;
        if (_requireLocation(data.sourceAccount, LocationKind.Account).scope != agency) {
            revert InvalidState(data.sourceAccount);
        }
        Budget storage budget = _budgets[budgetId];
        if (budget.sourceAccount != bytes32(0)) revert AlreadyProcessed(budgetId);
        budget.sourceAccount = data.sourceAccount;
        budget.paused = data.paused;
        _setRules(budgetId, budget, data.perOperationLimit, data.approvalThreshold, allowedDestinations);
    }

    /// @notice Genesis: someone's spending access (they need a role in the agency first).
    function importAllowance(bytes32 budgetId, address holder, uint256 perOperationLimit) external onlyOwner {
        bytes32 agency = _requireLocation(budgetId, LocationKind.Budget).scope;
        if (_roles[agency][holder] == Role.None) revert NotRegistered(bytes32(uint256(uint160(holder))));
        _allowances[budgetId][holder] =
            Allowance({active: true, perOperationLimit: perOperationLimit, epoch: membershipEpoch[agency][holder]});
        emit AllowanceSet(budgetId, holder, true, perOperationLimit);
    }

    /// @notice Genesis: what a Member received and still holds. Set once per person.
    function importMemberBalance(bytes32 agencyId, address member, uint256 amount) external onlyOwner {
        if (scopeKind[agencyId] != ScopeKind.Agency || _memberBalances[agencyId][member] != 0 || amount == 0) {
            revert InvalidState(agencyId);
        }
        _memberBalances[agencyId][member] = amount;
        _mintToLedger(amount);
    }

    /// @notice Genesis: a payment the seeded story made outside Viatik. Nothing moves: that
    /// money already left; only the record (and its proof, if any) is carried over.
    function importOutsidePayment(bytes32 agencyId, bytes32 opId, bytes32 evidenceHash) external onlyOwner {
        if (scopeKind[agencyId] != ScopeKind.Agency || opId == bytes32(0)) revert InvalidState(agencyId);
        if (_outside[agencyId][opId].paid) revert AlreadyProcessed(opId);
        _outside[agencyId][opId] = OutsideProof({paid: true, evidenceHash: evidenceHash});
    }

    /// @notice Genesis: a request still waiting for approval in the seeded story. Its
    /// requester needs a role and an allowance on the budget (import them first), even a
    /// placeholder address for a seeded person without a wallet.
    function importPendingRequest(ImportedRequest calldata data) external onlyOwner {
        bytes32 agency = _requireLocation(data.budget, LocationKind.Budget).scope;
        if (data.amount == 0) revert InvalidState(data.requestId);
        if (_requests[data.requestId].status != RequestStatus.None) revert AlreadyProcessed(data.requestId);
        _requireHolder(data.budget, agency, data.requester);
        _requests[data.requestId] = PaymentRequest({
            budget: data.budget,
            requester: data.requester,
            destination: data.destination,
            member: data.member,
            amount: data.amount,
            evidenceHash: data.evidenceHash,
            status: RequestStatus.Pending,
            epoch: membershipEpoch[agency][data.requester]
        });
        _processed[data.requester][data.requestId] = true;
        emit PaymentPending(data.requestId, data.budget, data.requester, data.amount);
    }

    // ─── Internals ──────────────────────────────────────────────────────────

    /// @dev The agreement's funding vault: the agency's unbound one, or a new one.
    function _bindVault(bytes32 vaultId, bytes32 agencyId, bytes32 agreementId) private {
        Location storage vault = _locations[vaultId];
        if (vault.kind == LocationKind.None) {
            _newLocation(vaultId, LocationKind.FundingVault, agencyId);
        } else if (
            vault.kind != LocationKind.FundingVault || vault.scope != agencyId || vaultAgreement[vaultId] != bytes32(0)
        ) {
            revert InvalidState(vaultId);
        }
        vaultAgreement[vaultId] = agreementId;
    }

    /// @dev Tranches start planned, except a first one without a milestone, which is
    /// available at once. Returns their total.
    function _addTranches(
        bytes32 agreementId,
        bytes32[] calldata trancheIds,
        uint256[] calldata amounts,
        bool[] calldata milestones
    ) private returns (uint256 total) {
        for (uint256 i; i < trancheIds.length; ++i) {
            bytes32 trancheId = trancheIds[i];
            if (trancheId == bytes32(0) || amounts[i] == 0 || _tranches[trancheId].status != TrancheStatus.None) {
                revert InvalidState(trancheId);
            }
            total += amounts[i];
            _tranches[trancheId] = Tranche({
                agreement: agreementId,
                amount: amounts[i],
                index: uint32(i),
                milestone: milestones[i],
                status: i == 0 && !milestones[i] ? TrancheStatus.Available : TrancheStatus.Planned,
                requestedBy: address(0),
                destination: bytes32(0),
                evidenceHash: bytes32(0)
            });
            _agreementTranches[agreementId].push(trancheId);
        }
    }

    /// @dev The budget rules that settle onchain, in the engine's order (evaluatePolicy):
    /// paused, destination, per-operation limit (budget and allowance), available funds.
    function _check(bytes32 budgetId, address holder, bytes32 destinationId, address member, uint256 amount)
        internal
        view
        returns (Reason, uint256)
    {
        Budget storage budget = _budgets[budgetId];
        if (budget.paused) return (Reason.BudgetPaused, 0);
        if (member == address(0) && !_destinationAllowed(budgetId, budget, destinationId)) {
            return (Reason.DestinationNotAllowed, 0);
        }
        uint256 perOperation = budget.perOperationLimit;
        uint256 holderLimit = _allowances[budgetId][holder].perOperationLimit;
        if (holderLimit != 0 && holderLimit < perOperation) perOperation = holderLimit;
        if (amount > perOperation) return (Reason.LimitExceeded, perOperation);
        uint256 available = _locations[budgetId].balance;
        if (amount > available) return (Reason.InsufficientFunds, available);
        return (Reason.None, 0);
    }

    /// @dev What a direct payment by an Admin must satisfy: budget pause, per-operation limit,
    /// allowed destination and the exception threshold of the Investor. Scheduled payments share it.
    function _requirePayable(
        bytes32 source,
        Location storage from,
        bytes32 agency,
        bytes32 destinationId,
        address member,
        uint256 amount
    ) private view {
        if (from.kind == LocationKind.Budget) {
            Budget storage budget = _budgets[source];
            if (budget.paused) revert BudgetPaused(source);
            if (amount > budget.perOperationLimit) {
                revert LimitExceeded(LimitRule.PerOperation, budget.perOperationLimit, amount);
            }
            if (member == address(0) && !_destinationAllowed(source, budget, destinationId)) {
                revert DestinationNotAllowed(source, destinationId);
            }
        }
        uint256 threshold = exceptionThresholdOf(agency);
        if (amount > threshold) revert LimitExceeded(LimitRule.Exception, threshold, amount);
    }

    function _requireSchedule(bytes32 scheduleId) private view returns (Schedule storage schedule_) {
        schedule_ = _schedules[scheduleId];
        if (schedule_.status == ScheduleStatus.None) revert NotRegistered(scheduleId);
    }

    /// @dev Who may pause, resume or cancel: an Admin of the agency or the Investor of its portfolio.
    function _requireScheduleManager(bytes32 agency) private view returns (address caller, bool asInvestor) {
        caller = _msgSender();
        asInvestor = _roles[agencyPortfolio[agency]][caller] == Role.Investor;
        if (!asInvestor && _roles[agency][caller] != Role.Admin) revert NotAuthorized(caller);
    }

    function _execute(bytes32 requestId, bytes32 paymentId, PaymentRequest storage request) private {
        _claim(paymentId);
        request.status = RequestStatus.Executed;
        bytes32 agency = _locations[request.budget].scope;
        _payOut(
            paymentId,
            requestId,
            request.budget,
            agency,
            request.destination,
            request.member,
            request.amount,
            request.evidenceHash
        );
    }

    /// @dev Takes the money out of `source` and pays the vendor (a real TestUSD transfer to
    /// the payout sink) or credits the Member's Viatik balance.
    function _payOut(
        bytes32 paymentId,
        bytes32 requestId,
        bytes32 source,
        bytes32 agency,
        bytes32 destinationId,
        address member,
        uint256 amount,
        bytes32 evidenceHash
    ) private {
        _debit(source, amount);
        bytes32 to = _target(destinationId, member);
        if (member != address(0)) {
            _memberBalances[agency][member] += amount;
        }
        emit PaymentExecuted(paymentId, requestId, source, destinationId, member, amount, evidenceHash);
        _record(paymentId, ReceiptKind.Payment, amount, source, to, evidenceHash);
        if (member == address(0)) TOKEN.transfer(payoutSink, amount);
    }

    function _setRules(
        bytes32 budgetId,
        Budget storage budget,
        uint256 perOperationLimit,
        uint256 approvalThreshold,
        bytes32[] calldata allowedDestinations
    ) private {
        budget.perOperationLimit = perOperationLimit;
        budget.approvalThreshold = approvalThreshold;
        budget.anyDestination = allowedDestinations.length == 0;
        uint64 epoch = budget.destinationEpoch;
        for (uint256 i; i < allowedDestinations.length; ++i) {
            _allowed[budgetId][epoch][allowedDestinations[i]] = true;
        }
        emit BudgetRulesUpdated(budgetId, perOperationLimit, approvalThreshold);
    }

    function _destinationAllowed(bytes32 budgetId, Budget storage budget, bytes32 destinationId)
        private
        view
        returns (bool)
    {
        return budget.anyDestination || _allowed[budgetId][budget.destinationEpoch][destinationId];
    }

    /// @dev The holder must still belong to the agency and keep an active allowance.
    function _requireHolder(bytes32 budgetId, bytes32 agency, address holder) private view {
        Role role = _roles[agency][holder];
        Allowance storage granted = _allowances[budgetId][holder];
        if (
            (role != Role.Member && role != Role.Admin) || !granted.active
                || granted.epoch != membershipEpoch[agency][holder]
        ) {
            revert NotAuthorized(holder);
        }
    }

    function _requireRole(bytes32 scope, Role role) private view returns (address caller) {
        caller = _msgSender();
        if (_roles[scope][caller] != role) revert NotAuthorized(caller);
    }

    /// @dev Agency Admin of `agencyId`, or Investor of its portfolio.
    function _requireAgencyManager(bytes32 agencyId) private view {
        address caller = _msgSender();
        if (_roles[agencyId][caller] != Role.Admin && _roles[agencyPortfolio[agencyId]][caller] != Role.Investor) {
            revert NotAuthorized(caller);
        }
    }

    function _requireRoleFitsScope(bytes32 scope, Role role) private view {
        bool fits = role == Role.Investor
            ? scopeKind[scope] == ScopeKind.Portfolio
            : (role == Role.Admin || role == Role.Member) && scopeKind[scope] == ScopeKind.Agency;
        if (!fits) revert NotRegistered(scope);
    }

    function _requireAgency(bytes32 agencyId) private view returns (bytes32 portfolio) {
        if (scopeKind[agencyId] != ScopeKind.Agency) revert NotRegistered(agencyId);
        portfolio = agencyPortfolio[agencyId];
    }

    function _requireAgreement(bytes32 agreementId) private view returns (Agreement storage agreement_) {
        agreement_ = _agreements[agreementId];
        if (agreement_.status == AgreementStatus.None) revert NotRegistered(agreementId);
    }

    function _requireActive(bytes32 agreementId, Agreement storage agreement_) private view {
        if (agreement_.status == AgreementStatus.Paused) revert AgreementPaused(agreementId);
        if (agreement_.status != AgreementStatus.Active) revert InvalidState(agreementId);
    }

    function _requireTranche(bytes32 trancheId) private view returns (Tranche storage tranche_) {
        tranche_ = _tranches[trancheId];
        if (tranche_.status == TrancheStatus.None) revert NotRegistered(trancheId);
    }

    function _requireLocation(bytes32 id, LocationKind kind) private view returns (Location storage location_) {
        location_ = _locations[id];
        if (location_.kind != kind) revert NotRegistered(id);
    }

    function _newLocation(bytes32 id, LocationKind kind, bytes32 scope) private {
        if (id == bytes32(0)) revert InvalidState(id);
        if (_locations[id].kind != LocationKind.None) revert AlreadyProcessed(id);
        _locations[id] = Location({kind: kind, scope: scope, balance: 0});
        emit LocationCreated(id, kind, scope);
    }

    function _setRole(bytes32 scope, address account, Role role) private {
        _roles[scope][account] = role;
        emit RoleSet(scope, account, role);
    }

    function _move(bytes32 from, bytes32 to, uint256 amount) private {
        if (_locations[to].kind == LocationKind.None) revert NotRegistered(to);
        _debit(from, amount);
        _locations[to].balance += amount;
    }

    /// @dev The first account opened (or imported) as Operations is the agency's.
    function _setOperations(bytes32 agencyId, bytes32 accountId) private {
        if (operationsAccount[agencyId] != bytes32(0)) return;
        operationsAccount[agencyId] = accountId;
        emit OperationsAccountSet(agencyId, accountId);
    }

    function _debit(bytes32 from, uint256 amount) private {
        uint256 balance = _locations[from].balance;
        if (amount > balance) revert InsufficientFunds(from, balance, amount);
        _locations[from].balance = balance - amount;
    }

    /// @dev Genesis mints the TestUSD behind imported balances, within TestUSD's per-call cap.
    function _mintToLedger(uint256 amount) private {
        uint256 max = TOKEN.MAX_MINT();
        while (amount > 0) {
            uint256 chunk = amount > max ? max : amount;
            TOKEN.mint(address(this), chunk);
            amount -= chunk;
        }
    }

    function _claim(bytes32 opId) private {
        address actor = _msgSender();
        if (_processed[actor][opId]) revert AlreadyProcessed(opId);
        _processed[actor][opId] = true;
    }

    function _record(bytes32 opId, ReceiptKind kind, uint256 amount, bytes32 from, bytes32 to, bytes32 evidenceHash)
        private
    {
        emit Recorded(opId, _msgSender(), receiptHash(opId, kind, amount, from, to, evidenceHash));
    }

    function _target(bytes32 destinationId, address member) private pure returns (bytes32) {
        return member == address(0) ? destinationId : _memberLocation(member);
    }

    function _memberLocation(address member) private pure returns (bytes32) {
        return bytes32(uint256(uint160(member)));
    }
}
