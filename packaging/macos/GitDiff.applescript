property serviceStartedByApp : false
property appSupportPath : ""
property sitePath : ""
property pidPath : ""
property logPath : ""
property pageURL : "http://localhost:9002/"
property pageOrigin : "http://localhost:9002"
property healthURL : "http://127.0.0.1:3101/health"

on run
	my initializePaths()
	my startGitDiff()
end run

on reopen
	my initializePaths()
	my startGitDiff()
end reopen

on idle
	return 30
end idle

on quit
	if serviceStartedByApp then my stopGitDiff()
	continue quit
end quit

on startGitDiff()
	if my serviceIsHealthy() then
		my showOrRefreshPage()
		return
	end if

	my stopStaleService()
	set launchCommand to "/bin/mkdir -p " & quoted form of appSupportPath & "; cd " & quoted form of sitePath & "; /usr/bin/nohup /usr/local/bin/node scripts/dev.mjs > " & quoted form of logPath & " 2>&1 < /dev/null & echo $! > " & quoted form of pidPath
	do shell script launchCommand
	set serviceStartedByApp to true

	repeat with attempt from 1 to 60
		delay 0.5
		if my serviceIsHealthy() then
			my showOrRefreshPage()
			display notification "本地 Git 差异阅读器已启动" with title "GitDiff"
			return
		end if
	end repeat

	display alert "GitDiff 启动失败" message "本地服务未能在 30 秒内启动。可以打开日志查看具体原因。" buttons {"关闭", "查看日志"} default button "查看日志" as critical
	if button returned of result is "查看日志" then do shell script "/usr/bin/open " & quoted form of logPath
end startGitDiff

on showOrRefreshPage()
	open location pageURL
	return false
end showOrRefreshPage

on initializePaths()
	set appSupportPath to (POSIX path of (path to application support from user domain)) & "GitDiff"
	set sitePath to appSupportPath & "/site"
	set pidPath to appSupportPath & "/GitDiff.pid"
	set logPath to appSupportPath & "/GitDiff.log"
end initializePaths

on serviceIsHealthy()
	try
		do shell script "/usr/bin/curl --silent --fail --max-time 1 " & quoted form of healthURL & " > /dev/null && /usr/bin/curl --silent --fail --max-time 1 " & quoted form of pageURL & " > /dev/null"
		return true
	on error
		return false
	end try
end serviceIsHealthy

on stopStaleService()
	try
		set oldPid to do shell script "/bin/cat " & quoted form of pidPath & " | /usr/bin/tr -cd '0-9'"
		if oldPid is not "" then do shell script "/bin/kill -TERM " & oldPid & " >/dev/null 2>&1 || true"
	on error
		-- A missing or stale PID file is harmless.
	end try
end stopStaleService

on stopGitDiff()
	try
		set servicePid to do shell script "/bin/cat " & quoted form of pidPath & " | /usr/bin/tr -cd '0-9'"
		if servicePid is not "" then do shell script "/bin/kill -TERM " & servicePid & " >/dev/null 2>&1 || true"
	on error
		-- The service may already have stopped.
	end try
	do shell script "/bin/rm -f " & quoted form of pidPath
end stopGitDiff
