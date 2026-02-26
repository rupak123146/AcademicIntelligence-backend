#!/bin/bash
# Role-Based Access Control - Verification Script
# Run this script to verify RBAC implementation

echo "🔐 Role-Based Access Control Verification Script"
echo "=================================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
BACKEND_URL="http://localhost:3000"
FRONTEND_URL="http://localhost:5173"

# Test results
PASSED=0
FAILED=0

# Helper function for test results
test_result() {
  local test_name=$1
  local result=$2
  
  if [ $result -eq 0 ]; then
    echo -e "${GREEN}✓ PASS${NC}: $test_name"
    ((PASSED++))
  else
    echo -e "${RED}✗ FAIL${NC}: $test_name"
    ((FAILED++))
  fi
}

# ============================================
# 1. Check Backend is Running
# ============================================
echo "1. Checking Backend Connection..."
echo "-----------------------------------"

response=$(curl -s -o /dev/null -w "%{http_code}" $BACKEND_URL/api/v1/health)
if [ "$response" == "200" ] || [ "$response" == "404" ]; then
  echo -e "${GREEN}✓${NC} Backend is running"
else
  echo -e "${RED}✗${NC} Backend not responding (HTTP $response)"
  echo "  Start backend: npm run dev"
fi
echo ""

# ============================================
# 2. Check Frontend is Running
# ============================================
echo "2. Checking Frontend Connection..."
echo "-----------------------------------"

response=$(curl -s -o /dev/null -w "%{http_code}" $FRONTEND_URL)
if [ "$response" == "200" ]; then
  echo -e "${GREEN}✓${NC} Frontend is running"
else
  echo -e "${YELLOW}ℹ${NC} Frontend not accessible (HTTP $response) - Start with: npm run dev"
fi
echo ""

# ============================================
# 3. Test Student Registration & Login
# ============================================
echo "3. Testing Student Registration & Login..."
echo "-------------------------------------------"

STUDENT_EMAIL="test.student.$(date +%s)@test.com"
STUDENT_PASSWORD="TestPassword123"

# Register student
student_register=$(curl -s -X POST $BACKEND_URL/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$STUDENT_EMAIL\",
    \"password\": \"$STUDENT_PASSWORD\",
    \"firstName\": \"Test\",
    \"lastName\": \"Student\",
    \"role\": \"student\"
  }")

student_token=$(echo $student_register | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ ! -z "$student_token" ]; then
  echo -e "${GREEN}✓${NC} Student registration successful"
  test_result "Student token generated" 0
  
  # Check token has role
  payload=$(echo $student_token | cut -d'.' -f2)
  decoded=$(echo "$payload" | base64 -d 2>/dev/null || echo $payload)
  
  if echo $decoded | grep -q "student"; then
    test_result "Student token contains 'student' role" 0
  else
    test_result "Student token contains 'student' role" 1
  fi
else
  echo -e "${RED}✗${NC} Student registration failed"
  test_result "Student registration" 1
fi
echo ""

# ============================================
# 4. Test Educator Registration & Login
# ============================================
echo "4. Testing Educator Registration & Login..."
echo "--------------------------------------------"

EDUCATOR_EMAIL="test.educator.$(date +%s)@test.com"
EDUCATOR_PASSWORD="TestPassword123"

educator_register=$(curl -s -X POST $BACKEND_URL/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"$EDUCATOR_EMAIL\",
    \"password\": \"$EDUCATOR_PASSWORD\",
    \"firstName\": \"Test\",
    \"lastName\": \"Educator\",
    \"role\": \"educator\"
  }")

educator_token=$(echo $educator_register | grep -o '"accessToken":"[^"]*' | cut -d'"' -f4)

if [ ! -z "$educator_token" ]; then
  echo -e "${GREEN}✓${NC} Educator registration successful"
  test_result "Educator token generated" 0
else
  echo -e "${RED}✗${NC} Educator registration failed"
  test_result "Educator registration" 1
fi
echo ""

# ============================================
# 5. Test Route Protection
# ============================================
echo "5. Testing Route Protection..."
echo "------------------------------"

# Test student accessing exam list
student_exams=$(curl -s -X GET "$BACKEND_URL/api/v1/exams" \
  -H "Authorization: Bearer $student_token" \
  -w "\n%{http_code}" | tail -1)

if [ "$student_exams" == "200" ]; then
  test_result "Student can access /api/v1/exams" 0
else
  test_result "Student can access /api/v1/exams" 1
fi

# Test student accessing educator analytics (should fail)
student_class_analytics=$(curl -s -X GET "$BACKEND_URL/api/v1/analytics/class/dashboard" \
  -H "Authorization: Bearer $student_token" \
  -w "\n%{http_code}" | tail -1)

if [ "$student_class_analytics" == "403" ]; then
  test_result "Student CANNOT access /api/v1/analytics/class/dashboard" 0
else
  test_result "Student CANNOT access /api/v1/analytics/class/dashboard" 1
fi

# Test educator can create exam
educator_create_exam=$(curl -s -X POST "$BACKEND_URL/api/v1/exams" \
  -H "Authorization: Bearer $educator_token" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Test Exam\",
    \"courseId\": \"test-course-id\",
    \"durationMinutes\": 60,
    \"totalMarks\": 100
  }" \
  -w "\n%{http_code}" | tail -1)

if [ "$educator_create_exam" == "201" ] || [ "$educator_create_exam" == "400" ]; then
  # 400 is ok if courseId doesn't exist, as long as it's not 403
  test_result "Educator can access POST /api/v1/exams" 0
else
  test_result "Educator can access POST /api/v1/exams" 1
fi

# Test student cannot create exam
student_create_exam=$(curl -s -X POST "$BACKEND_URL/api/v1/exams" \
  -H "Authorization: Bearer $student_token" \
  -H "Content-Type: application/json" \
  -d "{
    \"title\": \"Test Exam\",
    \"courseId\": \"test-course-id\",
    \"durationMinutes\": 60
  }" \
  -w "\n%{http_code}" | tail -1)

if [ "$student_create_exam" == "403" ]; then
  test_result "Student CANNOT POST /api/v1/exams" 0
else
  test_result "Student CANNOT POST /api/v1/exams" 1
fi
echo ""

# ============================================
# 6. Test Data Filtering
# ============================================
echo "6. Testing Data Filtering..."
echo "----------------------------"

# Get student's analytics
student_analytics=$(curl -s -X GET "$BACKEND_URL/api/v1/analytics/student/dashboard" \
  -H "Authorization: Bearer $student_token" \
  -w "\n%{http_code}" | tail -1)

if [ "$student_analytics" == "200" ]; then
  test_result "Student can access own analytics" 0
else
  test_result "Student can access own analytics" 1
fi

# Get educator's analytics
educator_analytics=$(curl -s -X GET "$BACKEND_URL/api/v1/analytics/class/dashboard" \
  -H "Authorization: Bearer $educator_token" \
  -w "\n%{http_code}" | tail -1)

if [ "$educator_analytics" == "200" ] || [ "$educator_analytics" == "404" ]; then
  test_result "Educator can access class analytics" 0
else
  test_result "Educator can access class analytics" 1
fi
echo ""

# ============================================
# 7. Test Missing Token
# ============================================
echo "7. Testing Authentication..."
echo "----------------------------"

# Test request without token
no_token=$(curl -s -X GET "$BACKEND_URL/api/v1/exams" \
  -w "\n%{http_code}" | tail -1)

if [ "$no_token" == "401" ]; then
  test_result "Request without token returns 401" 0
else
  test_result "Request without token returns 401" 1
fi

# Test request with invalid token
invalid_token=$(curl -s -X GET "$BACKEND_URL/api/v1/exams" \
  -H "Authorization: Bearer invalid-token" \
  -w "\n%{http_code}" | tail -1)

if [ "$invalid_token" == "401" ]; then
  test_result "Request with invalid token returns 401" 0
else
  test_result "Request with invalid token returns 401" 1
fi
echo ""

# ============================================
# 8. Check Files Modified
# ============================================
echo "8. Checking Implementation Files..."
echo "-----------------------------------"

if grep -q "user?.role === 'student'" ../frontend/src/pages/auth/LoginPage.tsx 2>/dev/null; then
  test_result "LoginPage has role-based redirect" 0
else
  test_result "LoginPage has role-based redirect" 1
fi

if grep -q "You can only view your own" ../backend/src/controllers/analyticsController.js 2>/dev/null; then
  test_result "Analytics controller has authorization checks" 0
else
  test_result "Analytics controller has authorization checks" 1
fi

if [ -f ../docs/ROLE_BASED_ACCESS_CONTROL.md ]; then
  test_result "RBAC documentation exists" 0
else
  test_result "RBAC documentation exists" 1
fi

if [ -f ../docs/RBAC_QUICK_REFERENCE.md ]; then
  test_result "Quick reference guide exists" 0
else
  test_result "Quick reference guide exists" 1
fi

if [ -f ../tests/role-based-access-control.test.js ]; then
  test_result "Test suite exists" 0
else
  test_result "Test suite exists" 1
fi
echo ""

# ============================================
# Summary
# ============================================
echo "=================================================="
echo "Test Summary"
echo "=================================================="
echo -e "${GREEN}✓ Passed:${NC} $PASSED"
echo -e "${RED}✗ Failed:${NC} $FAILED"
TOTAL=$((PASSED + FAILED))
echo -e "Total: $TOTAL"
echo ""

if [ $FAILED -eq 0 ]; then
  echo -e "${GREEN}✅ All checks passed!${NC}"
  echo ""
  echo "Your Role-Based Access Control implementation is working correctly!"
  echo ""
  echo "Next steps:"
  echo "1. Review the documentation: docs/ROLE_BASED_ACCESS_CONTROL.md"
  echo "2. Check the quick reference: docs/RBAC_QUICK_REFERENCE.md"
  echo "3. Run the full test suite: npm test -- role-based-access-control"
  echo "4. Test with your frontend at: $FRONTEND_URL"
else
  echo -e "${YELLOW}⚠️  Some checks failed. Review the failures above.${NC}"
  echo ""
  echo "Troubleshooting:"
  echo "1. Ensure backend is running: npm run dev"
  echo "2. Check MongoDB connection"
  echo "3. Verify .env file has correct configuration"
  echo "4. Check logs for error messages"
fi

echo ""
echo "=================================================="
