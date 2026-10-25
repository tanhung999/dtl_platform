import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const baseUrl = (__ENV.BASE_URL || 'http://localhost:5173').replace(/\/$/, '');
const username = __ENV.LOAD_TEST_USERNAME;
const password = __ENV.LOAD_TEST_PASSWORD;
const loginPerVu = (__ENV.LOGIN_PER_VU || 'false').toLowerCase() === 'true';
const loginLatency = new Trend('login_latency', true);
const businessFailures = new Rate('business_failures');

export const options = {
  scenarios: {
    five_hundred_active_users: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: __ENV.RAMP_UP || '2m', target: 500 },
        { duration: __ENV.HOLD || '5m', target: 500 },
        { duration: __ENV.RAMP_DOWN || '1m', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<1000', 'p(99)<2000'],
    login_latency: ['p(95)<2000'],
    business_failures: ['rate<0.01'],
  },
};

let authenticated = false;

function signIn() {
  const response = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({ username, password }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { operation: 'login' },
      timeout: '15s',
    },
  );
  loginLatency.add(response.timings.duration);
  const ok = check(response, { 'login succeeds': (item) => item.status === 200 });
  businessFailures.add(!ok);
  authenticated = ok;
}

export function setup() {
  if (!username || !password) {
    throw new Error('Set LOAD_TEST_USERNAME and LOAD_TEST_PASSWORD for a dedicated non-production test account.');
  }
  const health = http.get(`${baseUrl}/api/health`, { timeout: '10s' });
  if (health.status !== 200) throw new Error(`Platform is not ready: HTTP ${health.status}`);
  if (loginPerVu) return { cookie: '' };

  const response = http.post(
    `${baseUrl}/api/auth/login`,
    JSON.stringify({ username, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { operation: 'setup_login' }, timeout: '15s' },
  );
  loginLatency.add(response.timings.duration);
  if (response.status !== 200) throw new Error(`Load-test login failed: HTTP ${response.status}`);
  const cookie = Object.entries(response.cookies)
    .map(([name, values]) => `${name}=${values[0].value}`)
    .join('; ');
  if (!cookie) throw new Error('Platform did not return a session cookie.');
  return { cookie };
}

export default function (data) {
  if (loginPerVu && !authenticated) signIn();
  if (loginPerVu && !authenticated) {
    sleep(1);
    return;
  }

  const sessionParams = loginPerVu
    ? { tags: { operation: 'session' } }
    : { headers: { Cookie: data.cookie }, tags: { operation: 'session' } };
  const applicationParams = loginPerVu
    ? { tags: { operation: 'applications' } }
    : { headers: { Cookie: data.cookie }, tags: { operation: 'applications' } };
  const responses = http.batch([
    ['GET', `${baseUrl}/api/auth/me`, null, sessionParams],
    ['GET', `${baseUrl}/api/applications/me`, null, applicationParams],
  ]);
  const ok = check(responses, {
    'session is valid': (items) => items[0].status === 200,
    'application list succeeds': (items) => items[1].status === 200,
  });
  businessFailures.add(!ok);
  sleep(Math.random() * 2 + 1);
}
