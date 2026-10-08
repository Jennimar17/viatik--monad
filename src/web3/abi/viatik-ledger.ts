export const viatikLedgerAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'token',
        type: 'address',
        internalType: 'contract ITestUSD',
      },
      {
        name: 'registrar_',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'payoutSink_',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'JOIN_TYPEHASH',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MAX_RUNS',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'MIN_INTERVAL',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'uint32',
        internalType: 'uint32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'TOKEN',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'contract ITestUSD',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'acceptAgreement',
    inputs: [
      {
        name: 'agreementId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'agencyPortfolio',
    inputs: [
      {
        name: 'agency',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: 'portfolio',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'allocate',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'delta',
        type: 'int256',
        internalType: 'int256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'approvePayment',
    inputs: [
      {
        name: 'requestId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'paymentId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'cancelSchedule',
    inputs: [
      {
        name: 'scheduleId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'checkPayment',
    inputs: [
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'holder',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'destinationId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'member',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [
      {
        name: 'reason',
        type: 'uint8',
        internalType: 'enum ViatikLedger.Reason',
      },
      {
        name: 'limit',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'closeRequest',
    inputs: [
      {
        name: 'requestId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createAccount',
    inputs: [
      {
        name: 'accountId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'agencyId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'isOperations',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createAgreement',
    inputs: [
      {
        name: 'agreementId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'agencyId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'vaultId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'committed',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'exceptionThreshold',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'trancheIds',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
      {
        name: 'amounts',
        type: 'uint256[]',
        internalType: 'uint256[]',
      },
      {
        name: 'milestones',
        type: 'bool[]',
        internalType: 'bool[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createBudget',
    inputs: [
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'sourceAccount',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'perOperationLimit',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'approvalThreshold',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'allowedDestinations',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
      {
        name: 'allocation',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createPortfolio',
    inputs: [
      {
        name: 'portfolioId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'vaultId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createSchedule',
    inputs: [
      {
        name: 'input',
        type: 'tuple',
        internalType: 'struct ViatikLedger.ScheduleInput',
        components: [
          {
            name: 'id',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'source',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'destination',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'member',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'amount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'firstRunAt',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'interval',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'runs',
            type: 'uint32',
            internalType: 'uint32',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deposit',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'portfolioId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'vaultId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'eip712Domain',
    inputs: [],
    outputs: [
      {
        name: 'fields',
        type: 'bytes1',
        internalType: 'bytes1',
      },
      {
        name: 'name',
        type: 'string',
        internalType: 'string',
      },
      {
        name: 'version',
        type: 'string',
        internalType: 'string',
      },
      {
        name: 'chainId',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'verifyingContract',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'salt',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'extensions',
        type: 'uint256[]',
        internalType: 'uint256[]',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'exceptionThresholdOf',
    inputs: [
      {
        name: 'agencyId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'fundAgreement',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'agreementId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'portfolioVault',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getAgreement',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ViatikLedger.Agreement',
        components: [
          {
            name: 'agency',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'vault',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'committed',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'funded',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'released',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'exceptionThreshold',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'status',
            type: 'uint8',
            internalType: 'enum ViatikLedger.AgreementStatus',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getAllowance',
    inputs: [
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'holder',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ViatikLedger.Allowance',
        components: [
          {
            name: 'active',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'perOperationLimit',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'epoch',
            type: 'uint64',
            internalType: 'uint64',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getBudget',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ViatikLedger.Budget',
        components: [
          {
            name: 'sourceAccount',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'perOperationLimit',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'approvalThreshold',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'paused',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'anyDestination',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'destinationEpoch',
            type: 'uint64',
            internalType: 'uint64',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getLocation',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ViatikLedger.Location',
        components: [
          {
            name: 'kind',
            type: 'uint8',
            internalType: 'enum ViatikLedger.LocationKind',
          },
          {
            name: 'scope',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'balance',
            type: 'uint256',
            internalType: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getRequest',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ViatikLedger.PaymentRequest',
        components: [
          {
            name: 'budget',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'requester',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'destination',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'member',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'amount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'evidenceHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'status',
            type: 'uint8',
            internalType: 'enum ViatikLedger.RequestStatus',
          },
          {
            name: 'epoch',
            type: 'uint64',
            internalType: 'uint64',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSchedule',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ViatikLedger.Schedule',
        components: [
          {
            name: 'agency',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'source',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'destination',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'member',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'creator',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'amount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'nextRunAt',
            type: 'uint64',
            internalType: 'uint64',
          },
          {
            name: 'interval',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'runsLeft',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'status',
            type: 'uint8',
            internalType: 'enum ViatikLedger.ScheduleStatus',
          },
          {
            name: 'pausedByInvestor',
            type: 'bool',
            internalType: 'bool',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getTranche',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        internalType: 'struct ViatikLedger.Tranche',
        components: [
          {
            name: 'agreement',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'amount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'index',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'milestone',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'status',
            type: 'uint8',
            internalType: 'enum ViatikLedger.TrancheStatus',
          },
          {
            name: 'requestedBy',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'destination',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'evidenceHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'importAgreement',
    inputs: [
      {
        name: 'agreementId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'data',
        type: 'tuple',
        internalType: 'struct ViatikLedger.Agreement',
        components: [
          {
            name: 'agency',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'vault',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'committed',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'funded',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'released',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'exceptionThreshold',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'status',
            type: 'uint8',
            internalType: 'enum ViatikLedger.AgreementStatus',
          },
        ],
      },
      {
        name: 'trancheIds',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
      {
        name: 'tranches',
        type: 'tuple[]',
        internalType: 'struct ViatikLedger.Tranche[]',
        components: [
          {
            name: 'agreement',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'amount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'index',
            type: 'uint32',
            internalType: 'uint32',
          },
          {
            name: 'milestone',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'status',
            type: 'uint8',
            internalType: 'enum ViatikLedger.TrancheStatus',
          },
          {
            name: 'requestedBy',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'destination',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'evidenceHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'importAllowance',
    inputs: [
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'holder',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'perOperationLimit',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'importBudget',
    inputs: [
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'data',
        type: 'tuple',
        internalType: 'struct ViatikLedger.Budget',
        components: [
          {
            name: 'sourceAccount',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'perOperationLimit',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'approvalThreshold',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'paused',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'anyDestination',
            type: 'bool',
            internalType: 'bool',
          },
          {
            name: 'destinationEpoch',
            type: 'uint64',
            internalType: 'uint64',
          },
        ],
      },
      {
        name: 'allowedDestinations',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'importLocation',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'kind',
        type: 'uint8',
        internalType: 'enum ViatikLedger.LocationKind',
      },
      {
        name: 'scope',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'balance',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'isOperations',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'importMemberBalance',
    inputs: [
      {
        name: 'agencyId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'member',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'importPendingRequest',
    inputs: [
      {
        name: 'data',
        type: 'tuple',
        internalType: 'struct ViatikLedger.ImportedRequest',
        components: [
          {
            name: 'requestId',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'budget',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'requester',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'destination',
            type: 'bytes32',
            internalType: 'bytes32',
          },
          {
            name: 'member',
            type: 'address',
            internalType: 'address',
          },
          {
            name: 'amount',
            type: 'uint256',
            internalType: 'uint256',
          },
          {
            name: 'evidenceHash',
            type: 'bytes32',
            internalType: 'bytes32',
          },
        ],
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'importRole',
    inputs: [
      {
        name: 'scope',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'role',
        type: 'uint8',
        internalType: 'enum ViatikLedger.Role',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'importScope',
    inputs: [
      {
        name: 'portfolioId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'agencyId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'invalidatePermit',
    inputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'isDestinationAllowed',
    inputs: [
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'destinationId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'join',
    inputs: [
      {
        name: 'scope',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'role',
        type: 'uint8',
        internalType: 'enum ViatikLedger.Role',
      },
      {
        name: 'nonce',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'deadline',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'signature',
        type: 'bytes',
        internalType: 'bytes',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'keeper',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'memberBalance',
    inputs: [
      {
        name: 'agencyId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'member',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'memberLocation',
    inputs: [
      {
        name: 'member',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'membershipEpoch',
    inputs: [
      {
        name: 'agency',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'multicall',
    inputs: [
      {
        name: 'data',
        type: 'bytes[]',
        internalType: 'bytes[]',
      },
    ],
    outputs: [
      {
        name: 'results',
        type: 'bytes[]',
        internalType: 'bytes[]',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'namespace',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'nonces',
    inputs: [
      {
        name: 'owner',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'operationsAccount',
    inputs: [
      {
        name: 'agency',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: 'account',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'owner',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'pauseSchedule',
    inputs: [
      {
        name: 'scheduleId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pay',
    inputs: [
      {
        name: 'paymentId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'source',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'destinationId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'member',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'evidenceHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'payoutSink',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'processed',
    inputs: [
      {
        name: 'actor',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'opId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'receiptHash',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'kind',
        type: 'uint8',
        internalType: 'enum ViatikLedger.ReceiptKind',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'from',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'to',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'evidenceHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    name: 'registerAgency',
    inputs: [
      {
        name: 'agencyId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'portfolioId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'fundingVaultId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'registrar',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'address',
        internalType: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'releaseTranche',
    inputs: [
      {
        name: 'trancheId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'decisionHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'renounceOwnership',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestChanges',
    inputs: [
      {
        name: 'trancheId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'reject',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestPayment',
    inputs: [
      {
        name: 'requestId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'paymentId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'destinationId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'member',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'evidenceHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: 'outcome',
        type: 'uint8',
        internalType: 'enum ViatikLedger.RequestStatus',
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'requestTranche',
    inputs: [
      {
        name: 'trancheId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'destinationAccount',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'evidenceHash',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'resumeSchedule',
    inputs: [
      {
        name: 'scheduleId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'returnToAgency',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'agencyId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'revokeRole',
    inputs: [
      {
        name: 'scope',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'roleOf',
    inputs: [
      {
        name: 'scope',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'enum ViatikLedger.Role',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'runSchedule',
    inputs: [
      {
        name: 'scheduleId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'paymentId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'scopeKind',
    inputs: [
      {
        name: 'scope',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'uint8',
        internalType: 'enum ViatikLedger.ScopeKind',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setAgreementPaused',
    inputs: [
      {
        name: 'agreementId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'paused',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setAllowance',
    inputs: [
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'holder',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'active',
        type: 'bool',
        internalType: 'bool',
      },
      {
        name: 'perOperationLimit',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setBudgetPaused',
    inputs: [
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'paused',
        type: 'bool',
        internalType: 'bool',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setKeeper',
    inputs: [
      {
        name: 'keeper_',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setNamespace',
    inputs: [
      {
        name: 'namespace_',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setPayoutSink',
    inputs: [
      {
        name: 'sink',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setRegistrar',
    inputs: [
      {
        name: 'registrar_',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'tranchesOf',
    inputs: [
      {
        name: 'agreementId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: '',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'transfer',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'fromAccount',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'toAccount',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'transferOwnership',
    inputs: [
      {
        name: 'newOwner',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateRules',
    inputs: [
      {
        name: 'budgetId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'perOperationLimit',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'approvalThreshold',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'allowedDestinations',
        type: 'bytes32[]',
        internalType: 'bytes32[]',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'vaultAgreement',
    inputs: [
      {
        name: 'vault',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    outputs: [
      {
        name: 'agreement',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'withdraw',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'portfolioId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'vaultId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'to',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'withdrawMemberBalance',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'agencyId',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'to',
        type: 'address',
        internalType: 'address',
      },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'AgencyRegistered',
    inputs: [
      {
        name: 'agency',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'portfolio',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'fundingVault',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgreementAccepted',
    inputs: [
      {
        name: 'agreement',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'admin',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgreementCreated',
    inputs: [
      {
        name: 'agreement',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'agency',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'vault',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'committed',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgreementFunded',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'agreement',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'funded',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AgreementPausedSet',
    inputs: [
      {
        name: 'agreement',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'paused',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AllowanceSet',
    inputs: [
      {
        name: 'budget',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'holder',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'active',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
      {
        name: 'perOperationLimit',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BudgetAllocated',
    inputs: [
      {
        name: 'budget',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'delta',
        type: 'int256',
        indexed: false,
        internalType: 'int256',
      },
      {
        name: 'balance',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BudgetCreated',
    inputs: [
      {
        name: 'budget',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'agency',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'sourceAccount',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'allocation',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BudgetPausedSet',
    inputs: [
      {
        name: 'budget',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'paused',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'BudgetRulesUpdated',
    inputs: [
      {
        name: 'budget',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'perOperationLimit',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'approvalThreshold',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'portfolio',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'EIP712DomainChanged',
    inputs: [],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FundsReturned',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'agency',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'member',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'account',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'KeeperSet',
    inputs: [
      {
        name: 'keeper',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'LocationCreated',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'kind',
        type: 'uint8',
        indexed: false,
        internalType: 'enum ViatikLedger.LocationKind',
      },
      {
        name: 'scope',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'NamespaceSet',
    inputs: [
      {
        name: 'namespace',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OperationsAccountSet',
    inputs: [
      {
        name: 'agency',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'OwnershipTransferred',
    inputs: [
      {
        name: 'previousOwner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'newOwner',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PaymentApproved',
    inputs: [
      {
        name: 'requestId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'paymentId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'approver',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PaymentExecuted',
    inputs: [
      {
        name: 'paymentId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'requestId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'source',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'destination',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'member',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'evidenceHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PaymentPending',
    inputs: [
      {
        name: 'requestId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'budget',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'requester',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PaymentRejected',
    inputs: [
      {
        name: 'requestId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'budget',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'requester',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'reason',
        type: 'uint8',
        indexed: false,
        internalType: 'enum ViatikLedger.Reason',
      },
      {
        name: 'limit',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PayoutSinkSet',
    inputs: [
      {
        name: 'sink',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PortfolioCreated',
    inputs: [
      {
        name: 'portfolio',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'vault',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'investor',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Recorded',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'actor',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'receiptHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RegistrarSet',
    inputs: [
      {
        name: 'registrar',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RequestClosed',
    inputs: [
      {
        name: 'requestId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'by',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'declined',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'RoleSet',
    inputs: [
      {
        name: 'scope',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'role',
        type: 'uint8',
        indexed: false,
        internalType: 'enum ViatikLedger.Role',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ScheduleCreated',
    inputs: [
      {
        name: 'schedule',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'agency',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'source',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'destination',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'member',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'firstRunAt',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
      {
        name: 'interval',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
      {
        name: 'runs',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ScheduleRan',
    inputs: [
      {
        name: 'schedule',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'paymentId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'nextRunAt',
        type: 'uint64',
        indexed: false,
        internalType: 'uint64',
      },
      {
        name: 'runsLeft',
        type: 'uint32',
        indexed: false,
        internalType: 'uint32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ScheduleStatusChanged',
    inputs: [
      {
        name: 'schedule',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'status',
        type: 'uint8',
        indexed: false,
        internalType: 'enum ViatikLedger.ScheduleStatus',
      },
      {
        name: 'by',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TrancheChangesRequested',
    inputs: [
      {
        name: 'tranche',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'rejected',
        type: 'bool',
        indexed: false,
        internalType: 'bool',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TrancheReleased',
    inputs: [
      {
        name: 'tranche',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'agreement',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'account',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
      {
        name: 'decisionHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TrancheRequested',
    inputs: [
      {
        name: 'tranche',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'requester',
        type: 'address',
        indexed: false,
        internalType: 'address',
      },
      {
        name: 'account',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'evidenceHash',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Transferred',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'from',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'to',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'Withdrawn',
    inputs: [
      {
        name: 'opId',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'scope',
        type: 'bytes32',
        indexed: true,
        internalType: 'bytes32',
      },
      {
        name: 'source',
        type: 'bytes32',
        indexed: false,
        internalType: 'bytes32',
      },
      {
        name: 'to',
        type: 'address',
        indexed: true,
        internalType: 'address',
      },
      {
        name: 'amount',
        type: 'uint256',
        indexed: false,
        internalType: 'uint256',
      },
    ],
    anonymous: false,
  },
  {
    type: 'error',
    name: 'AddressEmptyCode',
    inputs: [
      {
        name: 'target',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'AgreementPaused',
    inputs: [
      {
        name: 'agreement',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'AlreadyProcessed',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'BudgetPaused',
    inputs: [
      {
        name: 'budget',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'DestinationNotAllowed',
    inputs: [
      {
        name: 'budget',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'destination',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'FailedCall',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InsufficientFunds',
    inputs: [
      {
        name: 'location',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'available',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidAccountNonce',
    inputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
      {
        name: 'currentNonce',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'InvalidShortString',
    inputs: [],
  },
  {
    type: 'error',
    name: 'InvalidState',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'LimitExceeded',
    inputs: [
      {
        name: 'rule',
        type: 'uint8',
        internalType: 'enum ViatikLedger.LimitRule',
      },
      {
        name: 'limit',
        type: 'uint256',
        internalType: 'uint256',
      },
      {
        name: 'amount',
        type: 'uint256',
        internalType: 'uint256',
      },
    ],
  },
  {
    type: 'error',
    name: 'NotAuthorized',
    inputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'NotDue',
    inputs: [
      {
        name: 'schedule',
        type: 'bytes32',
        internalType: 'bytes32',
      },
      {
        name: 'dueAt',
        type: 'uint64',
        internalType: 'uint64',
      },
    ],
  },
  {
    type: 'error',
    name: 'NotRegistered',
    inputs: [
      {
        name: 'id',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'OwnableInvalidOwner',
    inputs: [
      {
        name: 'owner',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'OwnableUnauthorizedAccount',
    inputs: [
      {
        name: 'account',
        type: 'address',
        internalType: 'address',
      },
    ],
  },
  {
    type: 'error',
    name: 'SchedulePaused',
    inputs: [
      {
        name: 'schedule',
        type: 'bytes32',
        internalType: 'bytes32',
      },
    ],
  },
  {
    type: 'error',
    name: 'StringTooLong',
    inputs: [
      {
        name: 'str',
        type: 'string',
        internalType: 'string',
      },
    ],
  },
] as const
