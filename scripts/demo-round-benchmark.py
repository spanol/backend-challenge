"""Measure live demo rounds without clearing wallets, journals or queues."""

import argparse
import datetime
import json
import statistics
import subprocess
import time
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--base-url', default='http://127.0.0.1:39324')
parser.add_argument('--expected-session-id', required=True)
parser.add_argument('--expected-peers', type=int, default=8000)
parser.add_argument('--profiles', default='4000,2000,1000')
parser.add_argument('--rounds', type=int, default=3)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--container-prefix', default='jungle-server')
parser.add_argument('--baseline-observations', type=Path)
args = parser.parse_args()
origin = urllib.parse.urlsplit(args.base_url)
if origin.hostname not in ('127.0.0.1', 'localhost') or origin.username or origin.password or origin.path or origin.query:
    raise ValueError('Use an explicitly selected loopback demo origin')
uuid.UUID(args.expected_session_id)
profiles = [int(value) for value in args.profiles.split(',')]
if not profiles or any(n < 1 or n > min(args.expected_peers, 8000) for n in profiles) or not 1 <= args.rounds <= 6:
    raise ValueError('Invalid population or round count')
args.output.mkdir(mode=0o700, parents=True, exist_ok=False)
containers = [f'{args.container_prefix}-{name}-1' for name in ('demo', 'app-observed', 'postgres', 'localstack')]


def run(*command):
    return subprocess.check_output(command, text=True)


def request(path, body=None):
    req = urllib.request.Request(args.base_url + path,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=255) as response:
        return json.load(response)


def checked_view():
    view = request('/demo/dashboard')
    state = view['state']
    if state['sessionId'] != args.expected_session_id or state['peerCount'] != args.expected_peers or state['mode'] != 'independent':
        raise RuntimeError('Selected demo session changed; refusing to continue')
    if view.get('operationError'):
        raise RuntimeError('Financial confirmation error: ' + view['operationError'])
    return view


def configure(enabled, count=None):
    body = {'enabled': enabled}
    if count is not None:
        body['peersPerRound'] = count
    return request('/demo/autoplay?view=dashboard', body)


def save(name, data):
    (args.output / name).write_text(json.dumps(data, indent=2))


baseline = json.loads(run('docker', 'inspect', *containers))
identities = {row['Name']: (row['Id'], row['RestartCount']) for row in baseline}
report = {'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'population': args.expected_peers, 'concurrentRequests': 32, 'roundsPerProfile': args.rounds,
          'profiles': [], 'passed': False}
wallet_ids = []


def audit():
    values = ','.join("('%s'::uuid)" % value for value in wallet_ids)
    sql = '''BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH target(id) AS (VALUES %s), balances AS (
 SELECT w.id,w.balance,w.version,COALESCE(SUM(CASE WHEN l.direction='CREDIT' THEN l.amount ELSE -l.amount END),0) calculated,
 COUNT(l.id) entries,MAX(l.wallet_version) max_version FROM target t JOIN wallets w ON w.id=t.id
 LEFT JOIN wallet_ledger l ON l.wallet_id=w.id GROUP BY w.id
), tx AS (SELECT wt.* FROM wager_transactions wt JOIN target t ON t.id=wt.wallet_id),
journals AS (SELECT j.transaction_id,COUNT(l.*) lines,SUM(CASE WHEN l.direction='CREDIT' THEN l.amount ELSE -l.amount END) delta
 FROM accounting_journals j JOIN target t ON t.id=j.wallet_id LEFT JOIN accounting_journal_lines l ON l.journal_id=j.transaction_id GROUP BY j.transaction_id)
SELECT json_build_object('wallets',(SELECT COUNT(*) FROM balances),
 'balanceDivergences',(SELECT COUNT(*) FROM balances WHERE balance<>calculated),
 'versionDivergences',(SELECT COUNT(*) FROM balances WHERE version<>max_version OR version<>entries),
 'negativeBalances',(SELECT COUNT(*) FROM balances WHERE balance<0),
 'unbalancedJournals',(SELECT COUNT(*) FROM journals WHERE lines<>2 OR delta<>0),
 'pendingTransactions',(SELECT COUNT(*) FROM tx WHERE status NOT IN ('PROCESSED','REJECTED','FAILED')),
 'rejectedTransactions',(SELECT COUNT(*) FROM tx WHERE status IN ('REJECTED','FAILED')),
 'unpublishedOutbox',(SELECT COUNT(*) FROM outbox o JOIN target t ON t.id=o.aggregate_id WHERE published_at IS NULL),
 'timestamp',now()); COMMIT;''' % values
    raw = subprocess.check_output(['docker', 'exec', '-i', containers[2], 'psql', '-X', '-U',
                                   'wagering_owner', '-d', 'wagering', '-t', '-A', '--set', 'ON_ERROR_STOP=1'],
                                  input=sql, text=True)
    result = json.loads(next(line for line in raw.splitlines() if line.startswith('{')))
    if result['wallets'] != args.expected_peers:
        raise RuntimeError('Audit population mismatch')
    for key in ('balanceDivergences', 'versionDivergences', 'negativeBalances', 'unbalancedJournals',
                'pendingTransactions', 'rejectedTransactions'):
        if result[key]:
            raise RuntimeError(f'Financial audit failed: {key}={result[key]}')
    return result


try:
    initial_view = checked_view()
    timing = initial_view.get('roundTiming', {'countdownMilliseconds': 5000, 'resultMilliseconds': 3700})
    if set(timing) != {'countdownMilliseconds', 'resultMilliseconds'} or any(type(value) is not int or not 0 < value <= 10000 for value in timing.values()):
        raise ValueError('Invalid server round timing')
    report['roundTiming'] = timing
    configure(False)
    deadline = time.monotonic() + 900
    while True:
        view = checked_view()
        if not view['blocked'] and not view['state']['hasOpenBet'] and view['state']['phase'] != 'flying':
            break
        if time.monotonic() > deadline:
            raise RuntimeError('Current round did not settle before benchmark')
        time.sleep(1)
    full = request('/demo/state')['state']
    wallet_ids = [str(uuid.UUID(peer['walletId'])) for peer in full['peers']]
    if len(set(wallet_ids)) != args.expected_peers:
        raise RuntimeError('Independent wallet population mismatch')
    report['initialAudit'] = audit()
    if args.baseline_observations:
        samples = json.loads(args.baseline_observations.read_text())
        ended = [sample for sample in samples if sample['phase'] == 'crashed' and not sample['blocked']
                 and sample['summary']['bets'] == 8000 and sample['summary']['active'] == 0]
        rounds = {}
        for sample in ended:
            rounds[sample['round']] = sample
        report['previous8000Observations'] = list(rounds.values())
        report['previous8000Timing'] = []
        for number, ended_sample in rounds.items():
            sequence = [s for s in samples if s['round'] == number]
            prep = [s for s in sequence if s['phase'] == 'betting']
            flight = [s for s in sequence if s['phase'] == 'flying']
            if prep and flight:
                epoch = lambda s: datetime.datetime.fromisoformat(s['at'].replace('Z', '+00:00')).timestamp()
                report['previous8000Timing'].append({'round': number,
                    'observedPreparationAndCountdownMs': int(1000 * (epoch(flight[0]) - epoch(prep[0]))),
                    'observedRoundMs': int(1000 * (epoch(ended_sample) - epoch(prep[0]))),
                    'partialPreparationStart': True})
    for count in profiles:
        before = checked_view()['state']['roundNumber']
        configure(True, count)
        samples, resources, rounds = [], [], {}
        starts, crashes = {}, {}
        first_seen, last_stats, last_print = {}, 0, 0
        deadline = time.monotonic() + 1200
        print(json.dumps({'profileStarted': count, 'rounds': args.rounds}), flush=True)
        while len(rounds) < args.rounds:
            view = checked_view()
            state, summary = view['state'], view['roundSummary']
            number = state['roundNumber']
            if state['autoplay']['peersPerRound'] != count or not state['autoplay']['enabled']:
                raise RuntimeError('Public autoplay configuration changed during benchmark')
            now = time.monotonic()
            sample = {'at': view['serverTime'], 'round': number, 'phase': state['phase'],
                      'pending': view['pendingOperationCount'], 'summary': summary}
            samples.append(sample)
            if number > before and summary['planned'] == count:
                first_seen.setdefault(number, view['serverTime'])
                if state['phase'] == 'betting':
                    starts.setdefault(number, view['serverTime'])
                    if summary['confirming'] and state.get('bettingEndsAt') is not None:
                        raise RuntimeError('Countdown started before confirmations')
                if state['phase'] == 'crashed':
                    crashes.setdefault(number, view['serverTime'])
                if (state['phase'] == 'crashed' and not view['blocked'] and not state['hasOpenBet']
                        and state.get('crashedEndsAt') is not None and number not in rounds):
                    if summary['bets'] != count or summary['cashed'] + summary['lost'] != count or summary['rejected']:
                        raise RuntimeError('Round participation or settlement mismatch')
                    start_index = (state['autoplay']['nextPeerIndex'] - count) % args.expected_peers
                    targets = (120, 150, 180, 220, 275, 400, None)
                    eligible_targets = [target for i in range(count)
                        if (target := targets[((start_index + i) % args.expected_peers + number - 1) % len(targets)])
                        is not None and target < state['crashAt']]
                    expected_cashouts = len(eligible_targets)
                    if summary['cashed'] != expected_cashouts:
                        raise RuntimeError(f'Automatic target settlement mismatch: expected {expected_cashouts}, got {summary["cashed"]}')
                    paid_cents = sum(eligible_targets)
                    expected_paid = f'{paid_cents // 100}.{paid_cents % 100:02d}'
                    if summary['paid'] != expected_paid or summary['wagered'] != f'{count}.00':
                        raise RuntimeError('Automatic wager or prize total mismatch')
                    if view.get('roundTiming', timing) != timing:
                        raise RuntimeError('Server timing changed during observation')
                    completed_at = state['crashedEndsAt'] - timing['resultMilliseconds']
                    prepared_at = state['startedAt'] - timing['countdownMilliseconds']
                    row = {'round': number, 'crashAt': state['crashAt'], 'bets': count,
                           'expectedCashouts': expected_cashouts,
                           'wagered': summary['wagered'], 'paid': summary['paid'], 'expectedPaid': expected_paid,
                           'cashouts': summary['cashed'], 'losses': summary['lost'],
                           'preparationMs': prepared_at - starts[number],
                           'flightAndSettlementMs': completed_at - state['startedAt'],
                           'lossSettlementMs': max(0, completed_at - crashes[number]),
                           'roundMs': completed_at - starts[number], 'pollIntervalMs': 1000}
                    rounds[number] = row
                    print(json.dumps({'profile': count, 'completed': row}), flush=True)
                    if len(rounds) == args.rounds:
                        configure(False)
                        break
            if now - last_stats >= 10:
                last_stats = now
                rows = json.loads(run('docker', 'inspect', *containers))
                for row in rows:
                    if (row['Id'], row['RestartCount']) != identities[row['Name']] or row['State']['OOMKilled']:
                        raise RuntimeError('Container restart, replacement or OOM during benchmark')
                stats = [json.loads(line) for line in run('docker', 'stats', '--no-stream', '--format',
                                                        '{{json .}}', *containers).splitlines()]
                resources.append({'at': view['serverTime'], 'stats': [{k:row[k] for k in
                                  ('Name','CPUPerc','MemUsage','MemPerc')} for row in stats]})
            save(f'{count}-samples.json', samples)
            save(f'{count}-resources.json', resources)
            if now - last_print >= 45:
                last_print = now
                print(json.dumps({'profile': count, 'round': number, 'phase': state['phase'],
                                  'confirmed': summary['bets'], 'pending': view['pendingOperationCount']}), flush=True)
            if now > deadline:
                raise RuntimeError(f'Profile {count} exceeded observation deadline')
            time.sleep(1)
        result = {'peersPerRound': count, 'rounds': list(rounds.values()), 'resourceSamples': len(resources),
                  'financialAudit': audit(),
                  'medianPreparationMs': statistics.median(row['preparationMs'] for row in rounds.values()),
                  'medianRoundMs': statistics.median(row['roundMs'] for row in rounds.values())}
        report['profiles'].append(result)
        save('report.json', report)
        print(json.dumps({'profileCompleted': result}), flush=True)
    candidates = [p for p in report['profiles'] if p['peersPerRound'] in (1000,2000)]
    winner = min(candidates, key=lambda p: (p['medianRoundMs'], p['medianPreparationMs']))
    report['selectedPeersPerRound'] = winner['peersPerRound']
    configure(True, winner['peersPerRound'])
    report['passed'] = True
    report['completedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save('report.json', report)
    print(json.dumps({'passed': True, 'selectedPeersPerRound': winner['peersPerRound']}), flush=True)
except BaseException as error:
    report['error'] = str(error)
    save('report.json', report)
    try:
        live = request('/demo/dashboard')['state']
        if live['sessionId'] == args.expected_session_id and live['peerCount'] == args.expected_peers:
            configure(False)
    except Exception:
        pass
    raise
