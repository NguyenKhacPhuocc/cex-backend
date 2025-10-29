#!/bin/bash

echo "🧪 Testing Rate Limiting - Login Endpoint"
echo "=========================================="
echo ""
echo "Rate limit: 5 attempts per minute"
echo "Attempting 7 login requests..."
echo ""

# Test login rate limit (5 attempts allowed per minute)
for i in {1..7}; do
  echo "Attempt $i:"
  
  response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://localhost:8000/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@test.com","password":"wrongpassword"}')
  
  http_body=$(echo "$response" | sed -e 's/HTTP_STATUS\:.*//g')
  http_status=$(echo "$response" | tr -d '\n' | sed -e 's/.*HTTP_STATUS://')
  
  if [ "$http_status" == "429" ]; then
    echo "  ❌ RATE LIMITED (429)"
    echo "  Response: $http_body"
  elif [ "$http_status" == "401" ]; then
    echo "  ✅ Request allowed (401 - wrong password)"
  else
    echo "  Status: $http_status"
    echo "  Response: $http_body"
  fi
  
  echo ""
  sleep 0.5
done

echo ""
echo "=========================================="
echo "Expected result:"
echo "  - Attempts 1-5: Should return 401 (wrong password)"
echo "  - Attempts 6-7: Should return 429 (rate limited)"
echo "=========================================="

