#!/usr/bin/env python3
"""TruthPass Consumer Agent 示例。

这个示例对应 CoinCall ``consumer_agent_v2.py`` 的宿主侧职责，但把
TruthPass 的产品验收边界写清楚：

1. 读取批次的确定性验收结果；
2. 读取 JEV/规则路由和 BOT Chain 主网状态；
3. 把带证据引用的结果转译成消费者能理解的说明；
4. 可选准备一笔用户钱包交易，但不读取、保存或广播私钥。

运行：

    python examples/truthpass_consumer_agent_v1.py FO-2026-001
    python examples/truthpass_consumer_agent_v1.py FO-2026-001 \
        --prepare purchase --wallet 0xYourWallet

默认 API 地址为 ``http://127.0.0.1:4173``，可用 ``TRUTHPASS_BASE_URL``
覆盖为 Vercel 或其他公开部署地址。交易准备只返回 calldata；真正的
签名和广播必须由 MetaMask、OKX 或其他 EIP-1193 钱包完成。
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


DEFAULT_BASE_URL = "http://127.0.0.1:4173"
DEFAULT_BATCH_ID = "FO-2026-001"
ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
LINE = "━" * 62


class AgentHttpError(RuntimeError):
    """保留 HTTP 状态和服务端返回，便于宿主 Agent 做下一步决策。"""

    def __init__(self, status: int, url: str, detail: str) -> None:
        super().__init__(f"HTTP {status} {url}: {detail}")
        self.status = status
        self.url = url
        self.detail = detail


def load_dotenv(path: str = ".env") -> None:
    """只加载非空环境变量，不打印任何值。"""

    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        for raw in handle:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip().strip("'\""))


def request_json(base_url: str, path: str, *, method: str = "GET", body: dict[str, Any] | None = None) -> dict[str, Any]:
    """调用 TruthPass 公共 JSON API。"""

    url = base_url.rstrip("/") + path
    payload = None
    headers = {"Accept": "application/json", "User-Agent": "truthpass-consumer-agent/1.0"}
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = Request(url, data=payload, headers=headers, method=method)
    try:
        with urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
            status = response.status
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        raise AgentHttpError(error.code, url, raw[:500]) from error
    except URLError as error:
        raise RuntimeError(f"无法连接 TruthPass API：{url} ({error.reason})") from error
    try:
        result = json.loads(raw)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"TruthPass 返回了非 JSON 响应（HTTP {status}）：{raw[:300]}") from error
    if not isinstance(result, dict):
        raise RuntimeError("TruthPass API 返回的 JSON 不是对象")
    return result


def pick_string(value: Any, default: str = "") -> str:
    return value if isinstance(value, str) else default


def verification_status(inspection: dict[str, Any]) -> str:
    verification = inspection.get("verification")
    nested = verification.get("status") if isinstance(verification, dict) else None
    return pick_string(nested, pick_string(inspection.get("status"), "unknown"))


def evidence_mode(inspection: dict[str, Any]) -> str:
    verification = inspection.get("verification")
    nested = verification.get("dataClass") if isinstance(verification, dict) else None
    return pick_string(nested, pick_string(inspection.get("dataClass"), "unknown"))


def render_consumer_answer(
    batch_id: str,
    inspection: dict[str, Any],
    jev: dict[str, Any],
    chain: dict[str, Any],
) -> dict[str, Any]:
    """只使用 API 返回事实，生成宿主 Agent 的结构化转译。"""

    verification = inspection.get("verification") if isinstance(inspection.get("verification"), dict) else {}
    assessment = verification.get("assessment") if isinstance(verification.get("assessment"), dict) else {}
    inspection_chain = inspection.get("chain") if isinstance(inspection.get("chain"), dict) else {}
    anchor = verification.get("anchor") if isinstance(verification.get("anchor"), dict) else inspection_chain
    status = pick_string(verification.get("status"), "unknown")
    if status == "unknown":
        status = pick_string(inspection.get("status"), "unknown")
    passed = status == "accepted"
    reasons = verification.get("reasons") if isinstance(verification.get("reasons"), list) else []
    chain_name = pick_string(chain.get("chainName"), "BOT Chain Mainnet")
    explorer = pick_string(chain.get("explorerUrl"), "https://scan.botchain.ai")
    tx_hash = pick_string(anchor.get("txHash"))
    receipts = anchor.get("receipts") if isinstance(anchor.get("receipts"), dict) else {}
    evidence_receipt = receipts.get("evidence") if isinstance(receipts.get("evidence"), dict) else {}
    if not tx_hash:
        tx_hash = pick_string(evidence_receipt.get("txHash"))
    jev_route = pick_string(jev.get("routeDecision"))
    jev_confidence = jev.get("confidence")
    decision = jev.get("decision") if isinstance(jev.get("decision"), dict) else {}
    answers = jev.get("answers") if isinstance(jev.get("answers"), dict) else {}
    route_answer = answers.get("route") if isinstance(answers.get("route"), dict) else {}
    if not jev_route:
        jev_route = pick_string(decision.get("decision"), pick_string(route_answer.get("choice"), "unknown"))
    if jev_confidence is None:
        jev_confidence = decision.get("confidence", route_answer.get("confidence"))
    jev_root = pick_string(jev.get("evidenceRoot"))
    if not jev_root:
        jev_root = pick_string(inspection_chain.get("evidenceRoot"))
    answer = (
        f"批次 {batch_id} 当前{'通过' if passed else '未通过/需要复核'}公开验收规则。"
        f" 数据模式为 {evidence_mode(inspection)}；JEV 路由为 {jev_route}，"
        f"置信度 {jev_confidence if jev_confidence is not None else 'unknown'}。"
    )
    if reasons:
        answer += " 需要关注：" + "；".join(str(item) for item in reasons[:3]) + "。"
    if anchor.get("submitted") is True and tx_hash:
        answer += f" 链上锚定已记录，可在 {explorer}/tx/{tx_hash} 查看。"
    else:
        answer += " 当前结果没有新的消费者交易回执，购买仍需用户钱包确认。"
    return {
        "schemaVersion": "truthpass.consumer-agent.answer.v1",
        "batchId": batch_id,
        "recommendation": "recommend" if passed else "review",
        "verificationStatus": status,
        "score": assessment.get("score", verification.get("score")),
        "jev": {
            "mode": pick_string(jev.get("mode"), "unknown"),
            "routeDecision": jev_route,
            "confidence": jev_confidence,
            "evidenceRoot": jev_root,
        },
        "chain": {
            "network": pick_string(chain.get("network"), "bot-mainnet"),
            "chainId": chain.get("chainId"),
            "contractAddress": pick_string(chain.get("contractAddress")),
            "explorerUrl": explorer,
            "anchorTxHash": tx_hash or None,
            "chainName": chain_name,
        },
        "answer": answer,
        "reasons": reasons,
        "nextAction": "prepare_wallet_transaction" if passed else "request_more_evidence",
    }


@dataclass(frozen=True)
class PreparedWalletAction:
    action: str
    event: str
    contract_address: str
    chain_id: int
    tx_request: dict[str, Any]
    ids: dict[str, Any]
    explorer_url: str


def prepare_wallet_action(base_url: str, batch_id: str, action: str, wallet: str, purchase_id: str | None) -> PreparedWalletAction:
    if not ADDRESS_RE.fullmatch(wallet):
        raise ValueError("--wallet 必须是 0x 开头的 40 字节 EVM 地址")
    if action == "contribution" and not purchase_id:
        raise ValueError("准备 contribution 时必须提供 --purchase-id")
    payload: dict[str, Any] = {
        "action": action,
        "batchId": batch_id,
        "wallet": wallet,
        "clientNonce": uuid.uuid4().hex,
    }
    if purchase_id:
        payload["purchaseId"] = purchase_id
    prepared = request_json(base_url, "/api/wallet/prepare", method="POST", body=payload)
    tx_request = prepared.get("txRequest") or prepared.get("transaction")
    if not isinstance(tx_request, dict):
        raise RuntimeError("钱包交易准备响应缺少 txRequest")
    event = pick_string(prepared.get("event"), pick_string(prepared.get("eventName")))
    if not event:
        event = {"purchase": "PurchaseRecorded", "contribution": "ContributionRecorded", "dispute": "ChallengeOpened"}.get(action, "")
    return PreparedWalletAction(
        action=pick_string(prepared.get("action"), action),
        event=event,
        contract_address=pick_string(prepared.get("contractAddress")),
        chain_id=int(prepared.get("chainId", 0)),
        tx_request=tx_request,
        ids=prepared.get("ids") if isinstance(prepared.get("ids"), dict) else {},
        explorer_url=pick_string(prepared.get("explorerUrl"), "https://scan.botchain.ai"),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="TruthPass Consumer Agent（查询、解释、准备用户钱包交易）")
    parser.add_argument("batch_id", nargs="?", default=DEFAULT_BATCH_ID, help="鱼油批次编号，例如 FO-2026-001")
    parser.add_argument("--base-url", default=os.environ.get("TRUTHPASS_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--prepare", choices=["purchase", "contribution", "dispute"], help="只准备钱包交易，不签名、不广播")
    parser.add_argument("--wallet", help="用户 EVM 钱包地址；只用于绑定交易 calldata")
    parser.add_argument("--purchase-id", help="contribution 需要绑定的 purchaseId")
    parser.add_argument("--json", action="store_true", help="只输出最终 JSON")
    args = parser.parse_args()
    load_dotenv()
    batch_id = args.batch_id.strip().upper()
    base_url = args.base_url.rstrip("/")
    if not re.fullmatch(r"FO-[A-Z0-9][A-Z0-9-]*", batch_id):
        parser.error("batch_id 格式应为 FO-2026-001")

    try:
        manifest = request_json(base_url, "/api/agent/manifest")
        inspection = request_json(base_url, f"/api/cli/inspect?batchId={batch_id}")
        jev = request_json(base_url, f"/api/jev/detection?batchId={batch_id}")
        chain = request_json(base_url, "/api/chain/status")
        result: dict[str, Any] = {
            "manifest": {
                "schemaVersion": pick_string(manifest.get("schemaVersion")),
                "version": pick_string(manifest.get("version")),
                "dataClass": pick_string(manifest.get("dataClass")),
            },
            "consumer": render_consumer_answer(batch_id, inspection, jev, chain),
            "wallet": {"mode": "user_owned_eip1193", "privateKeyRead": False},
        }
        if args.prepare:
            if not args.wallet:
                raise ValueError("准备交易时必须提供 --wallet；Agent 不接收私钥")
            prepared = prepare_wallet_action(base_url, batch_id, args.prepare, args.wallet, args.purchase_id)
            result["wallet"] = {
                "mode": "wallet_tx_prepared",
                "privateKeyRead": False,
                "action": prepared.action,
                "event": prepared.event,
                "contractAddress": prepared.contract_address,
                "chainId": prepared.chain_id,
                "ids": prepared.ids,
                "explorerUrl": prepared.explorer_url,
                "txRequest": prepared.tx_request,
                "nextStep": "由用户钱包调用 eth_sendTransaction；回读 receipt 后再调用 /api/chain/tx-confirm",
            }
        if args.json:
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0
        print(LINE)
        print("TruthPass · Consumer Agent v1（查询 + JEV/规则解释 + 用户钱包交易准备）")
        print(LINE)
        print(f"[0] API：{base_url} ｜ 批次：{batch_id} ｜ 数据：{result['manifest']['dataClass']}")
        consumer = result["consumer"]
        print(f"[1] 批次验收 → {consumer['verificationStatus']} ｜ 推荐：{consumer['recommendation']}")
        print(f"[2] JEV/规则 → {consumer['jev']['routeDecision']} ｜ confidence={consumer['jev']['confidence']}")
        print(f"[3] 区块链 → {consumer['chain']['chainName']} ｜ Chain ID={consumer['chain']['chainId']}")
        print(f"[4] Agent 转译 → {consumer['answer']}")
        if args.prepare:
            wallet = result["wallet"]
            print(f"[5] 钱包交易 → {wallet['action']} ｜ target={wallet['contractAddress']} ｜ 状态=wallet_tx_prepared")
            print("    私钥未读取；请在 MetaMask/OKX/Binance 钱包中确认并广播")
        print(LINE)
        return 0
    except (AgentHttpError, RuntimeError, ValueError) as error:
        print(f"[!] Consumer Agent 未完成：{error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
