import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Popconfirm, Progress, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { PlayCircleOutlined, RedoOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import StatBadge from '../components/common/StatBadge';
import EmptyPanel from '../components/common/EmptyPanel';
import { useReconStore } from '../stores/reconStore';
import { useDesignStore } from '../stores/designStore';
import type { IssueStatus, ReconItem, ReconRun, ReconStatus, SupplementTask } from '../types/recon';
import { SUPPLEMENT_CAPACITY, currentQuarter, gapsText, quarterOptions } from '../utils/recon';

const { Title, Paragraph, Text } = Typography;

const RECON_STATUS_TAG: Record<ReconStatus, { color: string; text: string }> = {
  running: { color: 'processing', text: '对账中' },
  interrupted: { color: 'orange', text: '已中断 · 可续跑' },
  done: { color: 'green', text: '已完成' },
};

const ISSUE_STATUS_TAG: Record<IssueStatus, { color: string; text: string }> = {
  none: { color: 'default', text: '无需下发' },
  issued: { color: 'green', text: '已下发' },
  queued: { color: 'orange', text: '排队顺延' },
  failed: { color: 'red', text: '下发失败' },
};

const fmtTime = (iso?: string) => (iso ? dayjs(iso).format('MM-DD HH:mm:ss') : '-');

/** 季度对账：设计见矿层位比对实测回次，覆盖不上的孔下发补勘；容量有限排满顺延，空位按序放 */
export default function ReconCenter() {
  const { message } = AntApp.useApp();
  const runs = useReconStore((s) => s.runs);
  const items = useReconStore((s) => s.items);
  const tasks = useReconStore((s) => s.tasks);
  const activeReconId = useReconStore((s) => s.activeReconId);
  const running = useReconStore((s) => s.running);
  const startRecon = useReconStore((s) => s.startRecon);
  const resumeRecon = useReconStore((s) => s.resumeRecon);
  const requestStop = useReconStore((s) => s.requestStop);
  const selectRun = useReconStore((s) => s.selectRun);
  const retryIssue = useReconStore((s) => s.retryIssue);
  const completeTask = useReconStore((s) => s.completeTask);
  const cancelTask = useReconStore((s) => s.cancelTask);
  const designs = useDesignStore((s) => s.designs);

  const [quarter, setQuarter] = useState(currentQuarter());

  const activeRun = runs.find((run) => run.id === activeReconId);
  const issued = useMemo(() => tasks.filter((task) => task.status === 'issued'), [tasks]);
  const queued = useMemo(() => tasks.filter((task) => task.status === 'queued').sort((a, b) => a.seq - b.seq), [tasks]);
  const failedCount = items.filter((item) => item.issueStatus === 'failed').length;

  const notifyStatus = (status: ReconStatus, label: string) => {
    if (status === 'done') message.success(`${label} 对账完成`);
    else message.warning(`${label} 对账已中断，已比过的孔保留，可续跑`);
  };

  const handleStart = async () => {
    if (designs.length === 0) {
      message.warning('设计台账为空，请先在「设计台账」页登记或按台帐回填');
      return;
    }
    notifyStatus(await startRecon(quarter), quarter);
  };

  const handleResume = async (reconId: string) => {
    notifyStatus(await resumeRecon(reconId), '续跑');
  };

  const handleRetry = async (item: ReconItem) => {
    try {
      const status = await retryIssue(item.id);
      if (status === 'none') message.success(`${item.holeNo} 按设计侧重新比对：层位已被实测回次覆盖，无需补勘`);
      else message.success(`${item.holeNo} 重试下发成功：${ISSUE_STATUS_TAG[status].text}`);
    } catch (error) {
      message.error((error as Error).message);
    }
  };

  const runColumns: TableColumnsType<ReconRun> = [
    { title: '季度', dataIndex: 'quarter', width: 90, render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '状态',
      width: 130,
      render: (_, row) => <Tag color={RECON_STATUS_TAG[row.status].color}>{RECON_STATUS_TAG[row.status].text}</Tag>,
    },
    {
      title: '比对进度',
      width: 170,
      render: (_, row) => (
        <Space size={6}>
          <Progress
            percent={row.total > 0 ? Math.round((row.compared / row.total) * 100) : 0}
            size="small"
            style={{ width: 90, margin: 0 }}
            status={row.status === 'interrupted' ? 'exception' : undefined}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            {row.compared}/{row.total}
          </Text>
        </Space>
      ),
    },
    { title: '发起时间', width: 130, render: (_, row) => fmtTime(row.createdAt) },
    {
      title: '说明',
      ellipsis: true,
      render: (_, row) => (
        <Text type="secondary" style={{ fontSize: 12 }}>
          {row.note ?? ''}
        </Text>
      ),
    },
    {
      title: '操作',
      width: 150,
      render: (_, row) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => selectRun(row.id)}>
            查看
          </Button>
          {row.status === 'interrupted' ? (
            <Button size="small" type="link" icon={<RedoOutlined />} disabled={running} onClick={() => handleResume(row.id)}>
              续跑
            </Button>
          ) : null}
          {row.status === 'running' ? (
            <Button size="small" type="link" danger icon={<StopOutlined />} onClick={requestStop}>
              中断
            </Button>
          ) : null}
        </Space>
      ),
    },
  ];

  const itemColumns: TableColumnsType<ReconItem> = [
    { title: '孔号', dataIndex: 'holeNo', width: 100, render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '设计见矿层位(m)',
      width: 130,
      render: (_, row) => `${row.oreFrom}~${row.oreTo}`,
    },
    {
      title: '断档区间(m)',
      width: 150,
      render: (_, row) => (row.gaps.length > 0 ? <Text type="danger">{gapsText(row.gaps)}</Text> : '—'),
    },
    {
      title: '结论',
      width: 100,
      render: (_, row) => (row.verdict === 'covered' ? <Tag color="green">覆盖</Tag> : <Tag color="red">覆盖不上</Tag>),
    },
    {
      title: '补勘下发',
      width: 170,
      render: (_, row) => (
        <Space size={4}>
          <Tag color={ISSUE_STATUS_TAG[row.issueStatus].color}>{ISSUE_STATUS_TAG[row.issueStatus].text}</Tag>
          {row.issueStatus === 'failed' ? (
            <Button size="small" type="link" onClick={() => handleRetry(row)}>
              按设计侧重试
            </Button>
          ) : null}
        </Space>
      ),
    },
    { title: '比对时间', width: 130, render: (_, row) => fmtTime(row.comparedAt) },
  ];

  const taskColumns = (withActions: boolean): TableColumnsType<SupplementTask> => [
    { title: '孔号', dataIndex: 'holeNo', width: 100, render: (v: string) => <Text strong>{v}</Text> },
    { title: '季度', dataIndex: 'quarter', width: 90 },
    { title: '补勘断档(m)', render: (_, row) => gapsText(row.gaps) },
    { title: '序号', dataIndex: 'seq', width: 70, align: 'right' },
    ...(withActions
      ? [
          {
            title: '操作',
            width: 130,
            render: (_: unknown, row: SupplementTask) => (
              <Space size={2}>
                <Popconfirm
                  title={`确认 ${row.holeNo} 补勘完成？`}
                  description="完成后腾出钻机容量，排队任务按序补位"
                  onConfirm={() => completeTask(row.id)}
                >
                  <Button size="small" type="link">
                    完成
                  </Button>
                </Popconfirm>
                <Popconfirm title={`确认撤销 ${row.holeNo} 的补勘任务？`} onConfirm={() => cancelTask(row.id)}>
                  <Button size="small" type="link" danger>
                    撤销
                  </Button>
                </Popconfirm>
              </Space>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        季度对账
      </Title>
      <Paragraph type="secondary">
        拿设计台账的见矿层位比对钻探班组的实测回次，覆盖不上的孔下发补勘；逐孔落库，中断可续跑。
      </Paragraph>

      <Alert
        style={{ marginBottom: 12 }}
        type="info"
        showIcon
        message={`补勘钻机容量 ${SUPPLEMENT_CAPACITY} 台：排满的孔排队顺延，已下发的照旧，空位按序补位。对账中断后已比过的孔保留，续跑只比剩下的；下发失败可按设计侧重试。`}
      />

      <Space style={{ marginBottom: 12 }} wrap>
        <span>
          <span style={{ color: '#6b7a86', marginRight: 6 }}>对账季度</span>
          <Select
            style={{ width: 130 }}
            value={quarter}
            options={quarterOptions().map((q) => ({ label: q, value: q }))}
            onChange={setQuarter}
            disabled={running}
          />
        </span>
        <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={handleStart}>
          发起对账
        </Button>
        {running ? (
          <Button danger icon={<StopOutlined />} onClick={requestStop}>
            中断对账
          </Button>
        ) : null}
      </Space>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="对账批次" value={runs.length} unit="个" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge
            label="补勘已下发"
            value={issued.length}
            unit={`/ ${SUPPLEMENT_CAPACITY} 台`}
            status={issued.length >= SUPPLEMENT_CAPACITY ? 'warning' : 'success'}
            hint="占用的补勘钻机容量"
          />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="排队顺延" value={queued.length} unit="个" status={queued.length ? 'warning' : 'default'} hint="容量排满，空位按序补位" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge
            label="下发失败"
            value={failedCount}
            unit="个"
            status={failedCount ? 'error' : 'success'}
            hint="当前批次中下发失败的孔，可按设计侧重试"
          />
        </Col>
      </Row>

      <Card title="对账批次" size="small" style={{ marginBottom: 16 }}>
        <Table
          rowKey="id"
          size="small"
          columns={runColumns}
          dataSource={runs}
          pagination={{ pageSize: 5, hideOnSinglePage: true }}
          scroll={{ x: 900 }}
          locale={{ emptyText: '暂无对账批次，选择季度后点击「发起对账」' }}
          rowClassName={(row) => (row.id === activeReconId ? 'ant-table-row-selected' : '')}
        />
      </Card>

      <Card
        title={activeRun ? `对账明细 · ${activeRun.quarter}（${RECON_STATUS_TAG[activeRun.status].text}）` : '对账明细'}
        size="small"
        style={{ marginBottom: 16 }}
      >
        {activeRun ? (
          <Table
            rowKey="id"
            size="small"
            columns={itemColumns}
            dataSource={items}
            pagination={{ pageSize: 6, hideOnSinglePage: true }}
            scroll={{ x: 800 }}
            locale={{ emptyText: '该批次还没有比对记录' }}
          />
        ) : (
          <EmptyPanel description="先从上方选择一个对账批次" />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card
            title="补勘任务 · 已下发"
            size="small"
            extra={
              <Tag color={issued.length >= SUPPLEMENT_CAPACITY ? 'orange' : 'green'}>
                容量 {issued.length}/{SUPPLEMENT_CAPACITY}
              </Tag>
            }
          >
            <Table
              rowKey="id"
              size="small"
              columns={taskColumns(true)}
              dataSource={issued}
              pagination={{ pageSize: 5, hideOnSinglePage: true }}
              scroll={{ x: 560 }}
              locale={{ emptyText: '暂无已下发的补勘任务' }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="补勘任务 · 排队顺延" size="small" extra={<Tag color={queued.length ? 'orange' : 'default'}>{queued.length} 个排队</Tag>}>
            <Table
              rowKey="id"
              size="small"
              columns={taskColumns(true)}
              dataSource={queued}
              pagination={{ pageSize: 5, hideOnSinglePage: true }}
              scroll={{ x: 560 }}
              locale={{ emptyText: '钻机容量未排满，无排队任务' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
