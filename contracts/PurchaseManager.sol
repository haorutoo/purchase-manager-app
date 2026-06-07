// --- /dev/null
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/ISomniaAgents.sol";

/// @title PurchaseManager
/// @notice Evaluates purchase requests using Somnia LLM Agent and generates shopping links
contract PurchaseManager {
    IAgentRequester public constant PLATFORM =
        IAgentRequester(0x037Bb9C718F3f7fe5eCBDB0b600D607b52706776);

    // LLM Inference Agent ID
    uint256 public constant LLM_AGENT_ID = 12847293847561029384;

    address public manager;
    string public policyRules;
    string public friendlyPolicyRules;

    struct RequestData {
        address user;
        string requestedItems;
        string resultJson;
        bool completed;
    }

    mapping(uint256 => RequestData) public requests;

    event ListSubmitted(uint256 indexed requestId, address indexed user, string items);
    event ListProcessed(uint256 indexed requestId, string resultJson);
    event RequestFailed(uint256 indexed requestId, ResponseStatus status);
    event PolicyUpdated(string newRules);
    event FriendlyPolicyUpdated(string friendlyRules);

    modifier onlyManager() {
        require(msg.sender == manager, "Only manager");
        _;
    }

    constructor(string memory initialRules) {
        manager = msg.sender;
        policyRules = initialRules;
        friendlyPolicyRules = initialRules; // Will be overwritten by LLM if updated via updatePolicy
    }

    /// @notice Updates the internal policy rules and requests a friendly version from the LLM agent
    function updatePolicy(string calldata newRules) external payable onlyManager returns (uint256 requestId) {
        policyRules = newRules;
        emit PolicyUpdated(newRules);

        uint256 deposit = PLATFORM.getRequestDeposit();
        require(msg.value >= deposit, "Insufficient STT deposit");

        string memory prompt = string.concat(
            "Rewrite the following corporate procurement rules to be friendly, welcoming, and encouraging for employees. Avoid sounding harsh, strict, or restrictive while keeping the core constraints clear. Rules:\n",
            newRules
        );

        string[] memory allowedValues = new string[](0);

        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            prompt,
            "You are a friendly and empathetic HR assistant.",
            false, 
            allowedValues
        );

        requestId = PLATFORM.createRequest{value: msg.value}(
            LLM_AGENT_ID,
            address(this),
            this.handleFriendlyPolicyResponse.selector,
            payload
        );
    }

    /// @notice Callback function invoked by the Somnia platform for friendly policy generation
    function handleFriendlyPolicyResponse(
        uint256 /* requestId */,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external {
        require(msg.sender == address(PLATFORM), "Only platform");

        if (status == ResponseStatus.Success && responses.length > 0) {
            string memory resultString = abi.decode(responses[0].result, (string));
            friendlyPolicyRules = resultString;
            emit FriendlyPolicyUpdated(resultString);
        }
    }

    /// @notice Submits a list of items to the LLM agent for evaluation
    function submitPurchaseList(string calldata items) external payable returns (uint256 requestId) {
        uint256 deposit = PLATFORM.getRequestDeposit();
        require(msg.value >= deposit, "Insufficient STT deposit");

        // We instruct the LLM to output pure JSON so our Firebase backend can easily parse it
        string memory prompt = string.concat(
            "You are a strict corporate procurement assistant. Evaluate the user's purchase list against the manager's rules.\n",
            "Manager Rules: ", policyRules, "\n",
            "Requested Items: ", items, "\n\n",
            "Instructions: Filter out items violating the rules. Keep reasoning very brief.\n",
            "Return ONLY a valid JSON array of objects with keys: 'item' (string), 'approved' (boolean), and 'reason' (string). No markdown blocks or extra text."
        );

        // Empty allowedValues means unconstrained output (so we can get JSON)
        string[] memory allowedValues = new string[](0);

        bytes memory payload = abi.encodeWithSelector(
            ILLMAgent.inferString.selector,
            prompt,
            "You are a JSON-generating procurement AI.",
            false, 
            allowedValues
        );

        requestId = PLATFORM.createRequest{value: msg.value}(
            LLM_AGENT_ID,
            address(this),
            this.handleLLMResponse.selector,
            payload
        );

        requests[requestId] = RequestData({
            user: msg.sender,
            requestedItems: items,
            resultJson: "",
            completed: false
        });

        emit ListSubmitted(requestId, msg.sender, items);
    }

    /// @notice Callback function invoked by the Somnia platform
    function handleLLMResponse(
        uint256 requestId,
        Response[] memory responses,
        ResponseStatus status,
        Request memory /* details */
    ) external {
        require(msg.sender == address(PLATFORM), "Only platform");
        require(!requests[requestId].completed, "Request already processed");

        if (status == ResponseStatus.Success && responses.length > 0) {
            string memory resultJson = abi.decode(responses[0].result, (string));
            requests[requestId].resultJson = resultJson;
            requests[requestId].completed = true;
            
            emit ListProcessed(requestId, resultJson);
        } else {
            emit RequestFailed(requestId, status);
        }
    }
}
