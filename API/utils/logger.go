package utils

import (
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/log"
)

var Logger = log.NewWithOptions(os.Stderr, log.Options{
	ReportTimestamp: true,
	TimeFormat:      time.Kitchen,
	Prefix:          "FGBP",
})

var successLogger = newStyledLogger(func(styles *log.Styles) {
	styles.Message = lipgloss.NewStyle().Foreground(lipgloss.Color("42"))
	styles.Levels[log.InfoLevel] = lipgloss.NewStyle().
		SetString(strings.ToUpper(log.InfoLevel.String())).
		Bold(true).
		MaxWidth(4).
		Foreground(lipgloss.Color("42"))
})

var errorLogger = newStyledLogger(func(styles *log.Styles) {
	styles.Message = lipgloss.NewStyle().Foreground(lipgloss.Color("196"))
	styles.Levels[log.ErrorLevel] = lipgloss.NewStyle().
		SetString(strings.ToUpper(log.ErrorLevel.String())).
		Bold(true).
		MaxWidth(4).
		Foreground(lipgloss.Color("196"))
})

func newStyledLogger(customize func(*log.Styles)) *log.Logger {
	logger := log.NewWithOptions(os.Stderr, log.Options{
		ReportTimestamp: true,
		TimeFormat:      time.Kitchen,
		Prefix:          "FGBP",
	})

	styles := log.DefaultStyles()
	customize(styles)
	logger.SetStyles(styles)

	return logger
}

func logMessage(args ...any) string {
	return strings.TrimSuffix(fmt.Sprintln(args...), "\n")
}

func Info(args ...any) {
	Logger.Info(logMessage(args...))
}

func Infof(format string, args ...any) {
	Logger.Info(fmt.Sprintf(format, args...))
}

func Warn(args ...any) {
	Logger.Warn(logMessage(args...))
}

func Warnf(format string, args ...any) {
	Logger.Warn(fmt.Sprintf(format, args...))
}

func Success(args ...any) {
	successLogger.Info(logMessage(args...))
}

func Successf(format string, args ...any) {
	successLogger.Info(fmt.Sprintf(format, args...))
}

func Error(args ...any) {
	errorLogger.Error(logMessage(args...))
}

func Errorf(format string, args ...any) {
	errorLogger.Error(fmt.Sprintf(format, args...))
}
