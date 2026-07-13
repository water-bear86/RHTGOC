import { readFileSync } from "node:fs"
import { describe, expect, it, vi } from "vitest"
import {
  EDGE_PARAMETER_KEYS,
  EDGE_STACK_QUERY,
  MAX_CANARY_WEIGHT,
  POLICY_STATUS_QUERY,
  assertSafeEdgeStatus,
  buildPolicyStatusArgs,
  buildStackStatusArgs,
  buildUpdateStackArgs,
  parseCanaryWeight,
  runRelease,
} from "./aws-edge-release.mjs"

describe("AWS edge release controls", () => {
  it("keeps first-create CloudFront settings compatible with AWS lifecycle rules", () => {
    const template = readFileSync(new URL("../deploy/aws/rhtgoc-edge.yaml", import.meta.url), "utf8")
    const htmlPolicy = template.slice(
      template.indexOf("  ClientHtmlCachePolicy:"),
      template.indexOf("  VersionedAssetCachePolicy:"),
    )

    expect(htmlPolicy).toContain("EnableAcceptEncodingBrotli: false")
    expect(htmlPolicy).toContain("EnableAcceptEncodingGzip: false")
    expect(template).toContain(
      "ContinuousDeploymentPolicyId: !If [CanaryIsEnabled, !GetAtt ContinuousDeploymentPolicy.Id, !Ref AWS::NoValue]",
    )
  })

  it("accepts only CloudFront's bounded canary weight", () => {
    expect(parseCanaryWeight("0")).toBe(0)
    expect(parseCanaryWeight("0.15")).toBe(MAX_CANARY_WEIGHT)
    expect(() => parseCanaryWeight("0.151")).toThrow(/between 0 and 0.15/)
    expect(() => parseCanaryWeight("-0.01")).toThrow(/between 0 and 0.15/)
    expect(() => parseCanaryWeight("not-a-number")).toThrow(/between 0 and 0.15/)
  })

  it("uses field-limited status queries", () => {
    const stackArgs = buildStackStatusArgs("sherwood-rhtgoc-edge", "us-east-1")
    const policyArgs = buildPolicyStatusArgs("50737be0-1598-4379-b873-474d08766e36", "us-east-1")
    expect(stackArgs).toContain(EDGE_STACK_QUERY)
    expect(policyArgs).toContain(POLICY_STATUS_QUERY)
    expect(stackArgs.join(" ")).not.toContain("Environment")
    expect(stackArgs.join(" ")).not.toMatch(/describe-stack-resources/)
    expect(policyArgs.join(" ")).not.toMatch(/ETag/)
  })

  it("preserves every non-overridden stack parameter", () => {
    const args = buildUpdateStackArgs(
      { CanaryEnabled: "true", CanaryWeight: 0.05 },
      "sherwood-rhtgoc-edge",
      "us-east-1",
    )
    for (const key of EDGE_PARAMETER_KEYS) {
      const argument = args.find((value) => value.startsWith(`ParameterKey=${key},`))
      expect(argument).toBeDefined()
      if (key === "CanaryEnabled" || key === "CanaryWeight") expect(argument).toContain("ParameterValue=")
      else expect(argument).toContain("UsePreviousValue=true")
    }
    expect(args).toContain("StackId")
    expect(() => buildUpdateStackArgs({ SurpriseSecret: "nope" })).toThrow(/unknown edge parameter/)
  })

  it("rejects broad or secret-bearing responses defensively", () => {
    expect(() => assertSafeEdgeStatus({ environment: { SAFE: "still forbidden" } })).toThrow(/forbidden/)
    expect(() => assertSafeEdgeStatus({ value: "SUPABASE_SECRET_KEY" })).toThrow(/forbidden/)
  })

  it("reports stack and policy state without broad AWS responses", () => {
    const spawn = vi
      .fn()
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          stackStatus: "CREATE_COMPLETE",
          canaryEnabled: "false",
          canaryWeight: "0",
          continuousDeploymentPolicyId: "50737be0-1598-4379-b873-474d08766e36",
          primaryDistributionId: "EPRIMARY",
          stagingDistributionId: "ESTAGING",
        }),
      })
      .mockReturnValueOnce({
        status: 0,
        stdout: JSON.stringify({
          enabled: false,
          type: "SingleWeight",
          traffic: { type: "SingleWeight", weight: 0, idleTTL: 900, maximumTTL: 3600 },
        }),
      })
    const write = vi.fn()

    const result = runRelease({ argv: ["status"], env: {}, spawn, write })

    expect(result.policy.enabled).toBe(false)
    expect(spawn).toHaveBeenCalledTimes(2)
    expect(spawn.mock.calls[0][1]).toContain(EDGE_STACK_QUERY)
    expect(spawn.mock.calls[1][1]).toContain(POLICY_STATUS_QUERY)
    expect(write).toHaveBeenCalledOnce()
  })

  it("enables a sticky canary through a bounded CloudFormation update", () => {
    const spawn = vi.fn(() => ({ status: 0, stdout: JSON.stringify("arn:aws:cloudformation:stack/test") }))
    const write = vi.fn()

    const result = runRelease({ argv: ["enable", "0.05"], env: {}, spawn, write })

    expect(result).toMatchObject({ accepted: true, action: "enable", requested: { CanaryEnabled: "true", CanaryWeight: 0.05 } })
    const args = spawn.mock.calls[0][1]
    expect(args).toEqual(expect.arrayContaining([
      "update-stack",
      "ParameterKey=CanaryEnabled,ParameterValue=true",
      "ParameterKey=CanaryWeight,ParameterValue=0.05",
      "StackId",
    ]))
  })

  it("refuses a non-us-east-1 target", () => {
    expect(() => buildStackStatusArgs("sherwood-rhtgoc-edge", "ca-central-1")).toThrow(/us-east-1/)
  })
})
