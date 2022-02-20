const builder = require('junit-report-builder')

const buildJunitTestReport = (runTestResult, reportPath = 'test-reports/test-report.xml') => {
  const suite = builder.testSuite().name('Sfdc tests')
  const successes = Array.isArray(runTestResult.successes) ? runTestResult.successes : [runTestResult.successes]
  const failures = Array.isArray(runTestResult.failures) ? runTestResult.failures : [runTestResult.failures]
  for (const x of [...successes, ...failures]) {
    const testCase = suite
      .testCase()
      .className(x.name)
      .name(x.methodName)
      .time(parseInt(x.time) / 1000)
    if (x.stackTrace) {
      testCase
        .failure(x.message, x.type)
        .stacktrace(x.stackTrace)
    }
  }
  builder.writeTo(reportPath)
}

module.exports = buildJunitTestReport
