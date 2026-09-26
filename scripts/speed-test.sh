#!/bin/bash
# 双站模型响应速度对比测试
# 老站: Cloudflare Pages | 新站: EdgeOne 新加坡(钉定优质IP 43.174.247.61 排除坏线路噪声)
KEY="sk_cf_2781e99f40f74df98c51a4592ab7ad95"
OLD="https://api.seurl.eu.org"
NEW="https://api.own.cloudns.nz"
NEW_IP="43.174.247.61"
OUT="/tmp/speed-test-results.txt"
> "$OUT"

MODELS=(
  "agnes/agnes-3.0-flash"
  "kilo/stepfun/step-3.7-flash:free"
  "kilo/kilo-auto/free"
  "openrouter/nvidia/nemotron-3.5-lightning:free"
  "opencode/mimo-v2.6-flash-free"
  "gemini/gemini-2.5-flash"
)

call() { # $1=site_url $2=model $3=resolve_flag
  local resolve=""
  [ -n "$3" ] && resolve="--resolve api.own.cloudns.nz:443:$NEW_IP"
  curl --noproxy '*' -s -N $resolve --max-time 60 -o /dev/null \
    -w "%{time_starttransfer} %{time_total} %{http_code}" \
    -X POST "$1/v1/chat/completions" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $KEY" \
    -d "{\"model\":\"$2\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}],\"max_tokens\":30,\"stream\":true}" 2>/dev/null
}

echo "=== 阶段1: 纯网关延迟 (GET /v1/models, 3次) ===" | tee -a "$OUT"
for entry in "老站-CF|$OLD|" "新站-EO|$NEW|1"; do
  name="${entry%%|*}"; rest="${entry#*|}"; url="${rest%%|*}"; pin="${rest#*|}"
  resolve=""; [ -n "$pin" ] && resolve="--resolve api.own.cloudns.nz:443:$NEW_IP"
  times=""
  for i in 1 2 3; do
    t=$(curl --noproxy '*' -s $resolve -o /dev/null -w "%{time_total}" --max-time 15 "$url/v1/models" -H "Authorization: Bearer $KEY" 2>/dev/null)
    times="$times $t"
  done
  echo "$name 网关延迟:$times 秒" | tee -a "$OUT"
done

echo "" | tee -a "$OUT"
echo "=== 阶段2: 模型流式首字/总耗时 (每模型3轮) ===" | tee -a "$OUT"
for model in "${MODELS[@]}"; do
  echo "" | tee -a "$OUT"
  echo "【$model】" | tee -a "$OUT"
  for entry in "老站-CF|$OLD|" "新站-EO|$NEW|1"; do
    name="${entry%%|*}"; rest="${entry#*|}"; url="${rest%%|*}"; pin="${rest#*|}"
    ttfb_sum=0; total_sum=0; ok=0
    detail=""
    for i in 1 2 3; do
      r=$(call "$url" "$model" "$pin")
      code=$(echo "$r" | awk '{print $3}')
      if [ "$code" = "200" ]; then
        ttfb=$(echo "$r" | awk '{print $1}')
        tot=$(echo "$r" | awk '{print $2}')
        ttfb_sum=$(echo "$ttfb_sum + $ttfb" | bc)
        total_sum=$(echo "$total_sum + $tot" | bc)
        ok=$((ok+1))
        detail="$detail ${ttfb}s/${tot}s"
      else
        detail="$detail 失败($code)"
      fi
      sleep 1
    done
    if [ $ok -gt 0 ]; then
      ttfb_avg=$(echo "scale=2; $ttfb_sum / $ok" | bc)
      total_avg=$(echo "scale=2; $total_sum / $ok" | bc)
      echo "  $name: 成功$ok/3 平均首字=${ttfb_avg}s 平均总耗时=${total_avg}s (各轮:$detail)" | tee -a "$OUT"
    else
      echo "  $name: 全部失败 $detail" | tee -a "$OUT"
    fi
  done
done

echo "" | tee -a "$OUT"
echo "=== 测试完成 ===" | tee -a "$OUT"
